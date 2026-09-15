-- The study path's ticks join the reviewers' score sheets.
--
-- Same store, one more key. Ticking off "Day 7 reviewed" on the ME Workflow is
-- the same kind of fact as an ME Reviewer score: personal, not evidence of
-- anything, and wrong to lose because a cache was cleared. Giving it its own
-- table would mean a second repository, a second controller and a second reset
-- button that all behave identically.
--
-- So `bank` now reads as "which study surface", not "which question bank". The
-- reviewers keep 'me' and 'pe'; the workflow's ticks are 'workflow'.
--
-- The standalone ME Workflow said these ticks were "saved in this browser only",
-- and that sentence is vendored content this project does not edit. The Study
-- path screen therefore writes its own line about where progress is kept — the
-- data file stays byte-identical, and nothing on screen claims something untrue.

alter table quiz_progress drop constraint if exists quiz_progress_bank_check;

alter table quiz_progress
  add constraint quiz_progress_bank_check
  check (bank in ('me', 'pe', 'workflow'));
