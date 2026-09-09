import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

from fastapi.testclient import TestClient
from app.main import app
from app.rag import ingestion
from app.api import documents
from app.services.dashboard_chat import grounded_answer


class DocumentIngestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.docs = self.root / 'documents'
        self.docs.mkdir()
        self.patches = [patch.object(ingestion, 'UPLOAD_DIR', self.docs), patch.object(documents, 'UPLOAD_DIR', self.docs),
                        patch.object(ingestion, 'CHROMA_DB_DIR', self.root / 'chroma'),
                        patch.object(ingestion, '_ingestion_state', {'status': 'idle', 'status_scope': 'process'})]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(app)
        for target in ('app.rag.ingestion.logger.error', 'app.api.documents.logger.error'):
            p = patch(target)
            p.start()
            self.addCleanup(p.stop)

    def test_health_upload_and_mock_ingestion(self):
        self.assertEqual(self.client.get('/health').status_code, 200)
        upload = self.client.post('/documents/upload', files={'file': ('dictionary.txt', b'Age is measured in years.', 'text/plain')})
        self.assertEqual(upload.status_code, 201)
        self.assertTrue((self.docs / upload.json()['saved_filename']).exists())
        def embed(texts):
            running = self.client.get('/documents/ingest/status').json()
            self.assertEqual(running['status'], 'running')
            self.assertEqual(running['step'], 'embedding')
            return [[0.0, 1.0] for _ in texts]
        with patch.object(ingestion, 'get_chroma_collection') as collection, patch.object(ingestion, 'create_embeddings', side_effect=embed):
            response = self.client.post('/documents/ingest')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['chunks_created'], 1)
            collection.return_value.upsert.assert_called_once()
        self.assertEqual(self.client.get('/documents/ingest/status').json()['status'], 'completed')

    def test_no_documents_does_not_load_chroma_or_embeddings(self):
        with patch.object(ingestion, 'get_chroma_collection') as chroma, patch.object(ingestion, 'create_embeddings') as embed:
            result = self.client.post('/documents/ingest')
        self.assertEqual(result.status_code, 400)
        self.assertEqual(result.json()['failed_step'], 'document_loading')
        chroma.assert_not_called()
        embed.assert_not_called()

    def test_embedding_failure_json_status_and_cors(self):
        (self.docs / 'input.txt').write_text('Text to ingest')
        with patch.object(ingestion, 'get_chroma_collection'), patch.object(ingestion, 'create_embeddings', side_effect=ingestion.IngestionDependencyError('model unavailable')):
            response = self.client.post('/documents/ingest', headers={'Origin': 'https://reliable-spirit-production-e526.up.railway.app'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['failed_step'], 'embedding')
        self.assertEqual(response.headers['access-control-allow-origin'], 'https://reliable-spirit-production-e526.up.railway.app')
        self.assertEqual(self.client.get('/documents/ingest/status').json()['status'], 'error')

    def test_vector_failure_and_blank_document(self):
        (self.docs / 'input.txt').write_text('Some text')
        with patch.object(ingestion, 'get_chroma_collection', side_effect=PermissionError('denied')):
            self.assertEqual(self.client.post('/documents/ingest').json()['failed_step'], 'vector_store')
        (self.docs / 'input.txt').write_text('')
        with patch.object(ingestion, 'get_chroma_collection'), patch.object(ingestion, 'create_embeddings') as embed:
            self.assertEqual(self.client.post('/documents/ingest').json()['failed_step'], 'chunking')
        embed.assert_not_called()

    def test_status_error_is_json(self):
        with patch.object(documents, 'get_ingestion_status', side_effect=PermissionError('denied')):
            result = self.client.get('/documents/ingest/status')
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json()['status'], 'error')

    def test_model_load_failure_can_retry_without_real_model(self):
        model = object()
        constructor = MagicMock(side_effect=[RuntimeError('temporary download failure'), model])
        with patch.dict('sys.modules', {'sentence_transformers': SimpleNamespace(SentenceTransformer=constructor)}), patch.object(ingestion, '_embedding_model', None), patch.object(ingestion, '_embedding_model_error', None):
            with self.assertRaises(ingestion.IngestionDependencyError):
                ingestion.get_embedding_model()
            self.assertIs(ingestion.get_embedding_model(), model)
        self.assertEqual(constructor.call_count, 2)

    def test_workspace_fallback_without_variables(self):
        context = {'bde_workspace_active': True, 'workspace_name': 'Approved BDE workspace', 'dataset': {'filename': 'approved.csv'}, 'evidence': {'documents': [{'filename': 'dictionary.txt'}]}, 'selected_question': {}}
        answer = grounded_answer('roles', 'which variables are being used?', context, [])
        self.assertIn('approved.csv', answer)
        self.assertIn('1 document', answer)
        self.assertIn('have not been selected', answer)


if __name__ == '__main__':
    unittest.main()
