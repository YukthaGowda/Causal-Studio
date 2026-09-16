import unittest

from app.services.review_export import assemble_review_package, export_review_package, ReviewExportError


class ReviewFormattingTests(unittest.TestCase):
    def test_roles_and_graph_are_tables_not_backend_objects(self):
        payload = self.payload()
        payload["phase_4_question_variables"]["confirmed_roles"] = [
            {"variable_name": "sleep", "final_role": "Exposure", "source": "Test fixture", "descriptive_meaning": "Sleep duration", "missing_percentage": 0},
        ]
        payload["phase_6_graph"]["confirmed_graph"]["edges"] = [
            {"source": "sleep", "target": "fatigue", "status": "uncertain", "notes": "Requires expert review"},
        ]
        package = assemble_review_package(payload)
        body = "\n".join(s["content"] for s in package["sections"])
        self.assertIn("| sleep | Exposure | Test fixture | Sleep duration | 0% missing |", body)
        self.assertIn("| sleep | fatigue | uncertain | Requires expert review |", body)
        self.assertNotIn("'source':", body)

    def test_serialized_artifacts_and_status_codes_are_readable(self):
        payload = self.payload()
        payload["project"]["rag_status"] = '{"status":"not_ready","message":"Please ingest documents"}'
        payload["phase_7_strategy"]["strategy"] = {"missing_data_strategy": "complete_case"}
        package = assemble_review_package(payload)
        body = "\n".join(s["content"] for s in package["sections"])
        self.assertIn("Status: Not ready", body)
        self.assertIn("Complete-case analysis", body)
        self.assertNotIn('{"status"', body)
        self.assertNotIn("not_ready", body)
        self.assertIn("Please ingest documents", body)

    def payload(self):
        return {
            "project": {"dataset_filename": "custom.csv", "research_objective": "Study sleep",
                        "rag_status": {"status": "completed", "files_processed": 3, "chunks_created": 233}},
            "phase_4_question_variables": {"confirmed_question": {"question_text": "Is sleep associated with fatigue?", "exposure": "sleep", "outcome": "fatigue"}},
            "phase_6_graph": {"confirmed_graph": {"nodes": [{"id": "sleep"}, {"id": "fatigue"}], "edges": []}},
            "phase_7_strategy": {"strategy": {"estimator": "linear"}},
            "phase_8_estimation": {"selected_primary_run": {"status": "completed", "model_type": "linear", "primary_result": {"exposure": "sleep", "outcome": "fatigue", "point_estimate": 0, "p_value": 0, "sample_size": 12, "confidence_interval": [-1, 1]}}},
            "report_preferences": {"unresolved_warnings_acknowledged": True},
        }

    def test_readable_body_uses_only_recorded_results(self):
        package = assemble_review_package(self.payload())
        body = export_review_package({"assembled_package": package, "format": "markdown"})["content"]
        self.assertIn("| Point estimate | 0 |", body)
        self.assertIn("| p-value | 0 |", body)
        self.assertIn("Not yet specified", body)
        self.assertIn("Formal identification is not fully implemented", body)
        for forbidden in ('```json', '"status":', 'null', 'binge', 'statistically significant'):
            self.assertNotIn(forbidden, body)
        self.assertIn("233", body)
        self.assertIn("does not prove causality", body)

    def test_missing_results_are_not_invented_and_export_stays_blocked(self):
        package = assemble_review_package({})
        self.assertFalse(package["ready_for_export"])
        self.assertIn("No numerical estimate", next(s["content"] for s in package["sections"] if s["section_id"] == "selected_estimation"))
        with self.assertRaises(ReviewExportError):
            export_review_package({"assembled_package": package, "format": "markdown"})

    def test_nested_warnings_are_preserved_and_deduplicated(self):
        payload = self.payload()
        payload["phase_5_feasibility"] = {"feasibility_result": {"data_quality_warnings": [
            {"severity": "high", "message": "Repeated observations require review"},
            {"severity": "high", "message": "Repeated observations require review"},
        ]}}
        package = assemble_review_package(payload)
        warnings = next(s["content"] for s in package["sections"] if s["section_id"] == "diagnostics")
        self.assertEqual(warnings.count("Repeated observations require review"), 1)
        self.assertIn("Repeated measures", warnings)
        self.assertTrue(package["unresolved_warnings"])

    def test_mismatch_remains_blocked(self):
        payload = self.payload()
        payload["artifact_consistency"] = {"issues": ["Selected run does not match question"]}
        package = assemble_review_package(payload)
        self.assertFalse(package["ready_for_export"])
        with self.assertRaises(ReviewExportError):
            export_review_package({"assembled_package": package, "format": "markdown"})

    def test_raw_artifacts_are_opt_in_and_only_in_appendix(self):
        payload = self.payload()
        self.assertIsNone(assemble_review_package(payload)["raw_artifacts"])
        payload["report_preferences"]["include_raw_artifacts"] = True
        package = assemble_review_package(payload)
        body = export_review_package({"assembled_package": package, "format": "markdown"})["content"]
        main, appendix = body.split("## Technical Appendix: Raw backend artifacts")
        self.assertNotIn('```json', main)
        self.assertIn('```json', appendix)
        hidden = export_review_package({"assembled_package": package, "format": "markdown", "include_appendix": False})["content"]
        self.assertNotIn('```json', hidden)


if __name__ == "__main__":
    unittest.main()
