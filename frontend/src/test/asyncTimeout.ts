import { configure } from '@testing-library/react';

/*
 * How long `findBy…` and `waitFor` wait, ms: three seconds, not testing-library's one.
 *
 * The first async test in a screen's file pays for the cold first render — the modules, the
 * router, the whole board — and under a parallel run on a busy machine that sometimes took more
 * than a second. `Dashboard` ("heads the canvas…") and `ArchiveScreen` ("says the shelf is
 * empty…") failed that way in two of five full runs and never once alone. A genuinely missing
 * element still fails; it fails after three seconds instead of one.
 */
configure({ asyncUtilTimeout: 3000 });
