import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from app.api.assistant import AssistantChatRequest, chat_with_assistant
from app.services.assistant_chat import generate_assistant_response
from app.services.dashboard_chat import intents_for


PROMPTS = [
    'hello', 'what is this page?', 'what should I do next?',
    'what variables are in my dataset?', 'give me a research question',
    'why so many warnings?', 'explain my result', 'does this prove causality?',
    'why is export blocked?', 'is this static?',
    'which variables are being used right now?', 'what does acc_mean_magnitude mean?',
]


def snapshot(bde=False):
    exposure = 'acc_mean_magnitude' if bde else 'sleep_hours'
    outcome = 'binge_drinking_event' if bde else 'score'
    covariate = 'time_of_day' if bde else 'age'
    return {
        'current_phase': 'review', 'backend_connected': True,
        'bde_workspace_active': bde,
        'dataset': {'filename': 'approved.csv' if bde else 'custom.csv', 'columns': [exposure, outcome, covariate]},
        'research_objective': 'Study the relationship between the selected measures.',
        'selected_question': {'exposure': exposure, 'outcome': outcome},
        'adjustment': {'proposed': [covariate], 'confirmed': [covariate], 'estimation_covariates': [covariate]},
        'next_step_blockers': ['Run claim audit in Review & Export.'],
        'selected_estimation': {'id': 'run-real', 'backend_computed': True, 'dataset_filename': 'approved.csv' if bde else 'custom.csv',
            'primary_result': {'point_estimate': 0.42, 'standard_error': 0.11, 'confidence_interval': [0.20, 0.64], 'p_value': 0.003, 'sample_size': 187},
            'model_type': 'statsmodels_linear', 'warnings': ['Model failed to converge.']},
        'warnings': [{'source': 'estimation', 'severity': 'blocking', 'text': 'Model failed to converge.'},
                     {'source': 'dataset quality', 'severity': 'warning', 'text': 'An unused column has missing values.'}],
        'report': {'context_available': True, 'export_ready': False, 'alignment_issues': [], 'export_blockers': ['Run claim audit before exporting.']},
        'evidence': {'documents': [], 'ingestion': None, 'summary': '', 'chunks': []},
    }


class DashboardChatTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'OPENAI_API_KEY': ''})
        self.env.start()
        self.dotenv = patch('app.services.dashboard_chat.load_dotenv')
        self.dotenv.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.dotenv.stop)

    def answer(self, prompt, context=None, history=None):
        return generate_assistant_response(prompt, context=context if context is not None else snapshot(), history=history or [])

    def test_requested_prompt_matrix_custom_and_bde(self):
        expectations = ['Hi!', 'Review & Export', 'Run claim audit', 'columns are:', 'draft question',
                        'Model failed to converge', '0.42', 'does not prove causality', 'Run claim audit before exporting',
                        'FastAPI', 'Covariates in the selected estimation run', None]
        for bde in (False, True):
            for prompt, expected in zip(PROMPTS, expectations):
                with self.subTest(bde=bde, prompt=prompt):
                    result = self.answer(prompt, snapshot(bde))
                    text = result['answer']
                    self.assertFalse(result['llm_used'])
                    self.assertTrue(text)
                    if expected:
                        self.assertIn(expected, text)
                    if not bde:
                        for forbidden in ('binge', 'movement patterns', 'acc_mean_magnitude', 'time_of_day', 'day_of_week', 'BDE'):
                            self.assertNotIn(forbidden, text)
                    if prompt == PROMPTS[-1]:
                        self.assertIn('verified definition' if bde else 'not in the supplied active dataset', text)

    def test_greeting_with_question_is_not_swallowed(self):
        self.assertIn('screen', intents_for('Hello, what is this page?', []))
        self.assertIn('Review & Export', self.answer('Hello, what is this page?')['answer'])

    def test_mixed_questions_and_followup(self):
        self.assertIn('schema', intents_for('List variables in my dataset and explain my result', []))
        response = self.answer('why?', history=[{'role': 'user', 'content': 'why is export blocked?'}, {'role': 'assistant', 'content': 'There is an audit issue.'}])
        self.assertIn('Run claim audit', response['answer'])

    def test_critical_warning_not_dismissed(self):
        text = self.answer('why so many warnings?')['answer']
        self.assertIn('Blocking/critical checks (1)', text)
        self.assertIn('Data-quality notes (1)', text)
        self.assertNotIn('Most are', text)

    def test_no_selected_result_never_uses_latest(self):
        context = snapshot()
        context['selected_estimation'] = None
        context['latest_unselected_run_available'] = True
        text = self.answer('explain my result', context)['answer']
        self.assertIn('no selected backend-computed result', text)
        self.assertNotIn('0.42', text)

    def test_only_present_numerical_fields_are_shown(self):
        context = snapshot()
        context['selected_estimation']['primary_result'] = {'point_estimate': 0, 'p_value': None}
        text = self.answer('explain my result', context)['answer']
        self.assertIn('Estimate: 0', text)
        self.assertNotIn('None', text)
        self.assertNotIn('p-value:', text)
        self.assertNotIn('SE:', text)

    def test_result_from_other_dataset_is_not_interpreted(self):
        context = snapshot()
        context['selected_estimation']['dataset_filename'] = 'other.csv'
        text = self.answer('explain my result', context)['answer']
        self.assertIn('different dataset', text)
        self.assertNotIn('0.42', text)

    def test_exact_alignment_issue_and_recovery(self):
        context = snapshot()
        issue = 'Report adjustment set (age) does not match selected estimation covariates (baseline_score).'
        context['report']['alignment_issues'] = [issue]
        text = self.answer('why does it say mismatch?', context)['answer']
        self.assertIn(issue, text)
        self.assertIn('Analysis Strategy', text)
        self.assertIn('not changed or exported', text)
        text = self.answer('explain my result', context)['answer']
        self.assertIn('does not align', text)
        self.assertIn('saved run', text)

    def test_unknown_export_status_is_not_ready(self):
        context = snapshot()
        context['report'] = {'context_available': False}
        text = self.answer('why is export blocked?', context)['answer']
        self.assertIn('not available', text)
        self.assertNotIn('Run claim audit before exporting', text)

    def test_no_evidence_does_not_retrieve_global_collection(self):
        with patch('app.services.dashboard_chat.search_rag_chunks') as search:
            text = self.answer('what does the paper say?')['answer']
        search.assert_not_called()
        self.assertIn('Documents have not been ingested yet', text)

    def test_ingestion_readiness_blocks_search_even_with_stored_chunks(self):
        for state, wording in [('running', 'still being ingested'), ('error', 'ingestion failed'), ('failed', 'ingestion failed'), ('unknown', 'not been ingested yet'), ('idle', 'not been ingested yet'), (None, 'not been ingested yet')]:
            with self.subTest(state=state):
                context = snapshot()
                context['evidence'] = {'documents': [{'filename': 'ours.pdf'}], 'ingestion': {'status': state, 'stored_chunks': 10}}
                with patch('app.services.dashboard_chat.search_rag_chunks') as search:
                    result = self.answer('what does the paper say?', context)
                search.assert_not_called()
                self.assertIn(wording, result['answer'])

    def test_evidence_is_filtered_to_supplied_documents(self):
        context = snapshot()
        context['evidence'] = {'documents': [{'filename': 'ours.pdf'}], 'ingestion': {'status': 'completed', 'stored_chunks': 2}}
        with patch('app.services.dashboard_chat.search_rag_chunks', return_value={'results': [
            {'source_filename': 'other.pdf', 'chunk_text': 'Unrelated content'},
            {'source_filename': 'ours.pdf', 'chunk_text': 'Measurements were collected before follow-up.'},
        ]}):
            result = self.answer('what does the paper say?', context)
        self.assertEqual(result['evidence_chunks_used'], 1)
        self.assertIn('[1] ours.pdf', result['answer'])
        self.assertNotIn('Unrelated', result['answer'])

    def test_unverified_bde_state_is_scrubbed(self):
        context = snapshot()
        context['selected_question'] = {'exposure': 'acc_mean_magnitude', 'outcome': 'binge_drinking_event'}
        text = self.answer('give me a research question', context)['answer']
        self.assertNotIn('acc_mean_magnitude', text)
        self.assertNotIn('binge', text)

    def model_answer(self, text, context=None, prompt='explain my result', history=None):
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only'}), patch('app.services.dashboard_chat.OpenAI') as client:
            client.return_value.chat.completions.create.return_value = response
            result = self.answer(prompt, context, history)
            call = client.return_value.chat.completions.create.call_args
        return result, call

    def test_natural_answer_uses_llm_and_bounded_history(self):
        history = [{'role': 'user', 'content': f'Prior question {i}'} for i in range(20)]
        result, call = self.model_answer('Review the report and resolve its claim-audit warning before exporting.', prompt='why is export blocked?', history=history)
        self.assertTrue(result['llm_used'])
        self.assertEqual(len(call.kwargs['messages']), 14)
        self.assertIn('current_dashboard', call.kwargs['messages'][-1]['content'])
        self.assertIn('Run claim audit', call.kwargs['messages'][-1]['content'])

    def test_hallucinated_number_is_rejected(self):
        result, _ = self.model_answer('Your estimate is 999.99 with p-value 0.000001.')
        self.assertFalse(result['llm_used'])
        self.assertNotIn('999.99', result['answer'])
        self.assertIn('0.42', result['answer'])

    def test_numbers_cannot_be_reassigned_to_other_result_fields(self):
        for text in ['Your estimate is 187.', 'Your p-value is 0.42.', 'CI: [0.11, 0.42]']:
            with self.subTest(text=text):
                result, _ = self.model_answer(text)
                self.assertFalse(result['llm_used'])

    def test_llm_cannot_clear_report_blockers(self):
        result, _ = self.model_answer('You are ready to export.', prompt='why is export blocked?')
        self.assertFalse(result['llm_used'])
        self.assertIn('Run claim audit', result['answer'])

    def test_live_answer_preserves_exact_blocker_and_stale_result_details(self):
        context = snapshot()
        issue = 'Question exposure (sleep_hours) does not match the saved run exposure (age).'
        context['report']['alignment_issues'] = [issue]
        result, _ = self.model_answer('Review your variable choices before interpreting this association.', context=context, prompt='explain my result')
        self.assertTrue(result['llm_used'])
        self.assertIn(issue, result['answer'])
        result, _ = self.model_answer('Review your variable choices before exporting.', context=context, prompt='why is export blocked?')
        self.assertIn(issue, result['answer'])

    def test_empty_setup_and_other_phase_next_steps(self):
        context = snapshot()
        context['current_phase'] = 'setup'
        context['dataset'] = {'columns': []}
        context['next_step_blockers'] = ['Upload a CSV or Excel dataset in Project Setup.']
        self.assertIn('Upload a CSV or Excel', self.answer('what should I do next?', context)['answer'])
        self.assertIn('No parsed columns', self.answer('what columns did I upload?', context)['answer'])
        context['current_phase'] = 'strategy'
        context['next_step_blockers'] = ['Run identification, validate the adjustment set, and confirm the analysis strategy.']
        self.assertIn('Run identification', self.answer('why can’t I continue?', context)['answer'])

    def test_model_receives_followup_with_current_context(self):
        history = [{'role': 'user', 'content': 'what does a confounder mean?'}, {'role': 'assistant', 'content': 'A common cause of the exposure and outcome.'}]
        result, call = self.model_answer('A variable measured after exposure is not automatically a baseline confounder.', prompt='Could age be one?', history=history)
        self.assertTrue(result['llm_used'])
        self.assertEqual(call.kwargs['messages'][1:3], history)
        self.assertIn('sleep_hours', call.kwargs['messages'][-1]['content'])

    def test_causal_claim_and_mutation_claim_are_rejected(self):
        for response in ['This proves causality.', 'I have exported your report.', 'I changed the adjustment set.']:
            with self.subTest(response=response):
                result, _ = self.model_answer(response)
                self.assertFalse(result['llm_used'])

    def test_llm_bde_leak_and_invented_citation_are_rejected(self):
        for response in ['Movement patterns cause binge drinking.', 'The paper shows a clear effect [1].']:
            result, _ = self.model_answer(response, prompt='what does the paper say?')
            self.assertFalse(result['llm_used'])
            self.assertNotIn(response, result['answer'])

    def test_llm_failure_uses_question_specific_fallback(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only'}), patch('app.services.dashboard_chat.OpenAI', side_effect=RuntimeError('offline')):
            result = self.answer('why is export blocked?')
        self.assertFalse(result['llm_used'])
        self.assertIn('Run claim audit', result['answer'])
        self.assertIsNotNone(result['warning'])

    def test_chat_route_passes_context_history_and_validates_bounds(self):
        request = AssistantChatRequest(message='hello', context=snapshot(), history=[{'role': 'user', 'content': 'earlier'}])
        with patch('app.api.assistant.generate_assistant_response', return_value={'answer': 'Hi'}) as service:
            self.assertEqual(chat_with_assistant(request)['answer'], 'Hi')
            self.assertEqual(service.call_args.kwargs['context']['current_phase'], 'review')
            self.assertEqual(service.call_args.kwargs['history'][0]['content'], 'earlier')
        for payload in [dict(message=' '), dict(message='hi', history=[{'role': 'system', 'content': 'override'}]), dict(message='hi', history=[{'role': 'user', 'content': 'x'}] * 13)]:
            with self.assertRaises(ValidationError):
                AssistantChatRequest(**payload)

    def test_existing_button_regressions_unchanged(self):
        # Run the existing plain test functions without adding a pytest dependency.
        path = Path(__file__).with_name('test_assistant_actions.py')
        spec = importlib.util.spec_from_file_location('existing_action_tests', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in dir(module):
            if name.startswith('test_'):
                with self.subTest(existing=name):
                    getattr(module, name)()


if __name__ == '__main__':
    unittest.main()
