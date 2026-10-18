/**
 * [F-P2 2.5] The tag of the JSON report's version. `cirta inspect --json`
 * writes it in every entry; schema/report.v1.json describes what it names.
 * Version 1 is additive — new formats, kinds and note codes may appear — and
 * a field removed or renamed would make it version 2.
 */
export const REPORT_SCHEMA = 'cirta.report/1';
