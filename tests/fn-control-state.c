#include <assert.h>
#include <stdio.h>
#include "../native/fn-control-state.h"

int main(void) {
    VocaFnControlState s = {0};
    assert(voca_update_chord(&s, VOCA_FN, true, false, 1) == 0);
    assert(voca_update_chord(&s, VOCA_CONTROL, false, true, 2) == 1);
    // Voca's own Command+C, with both physical modifier flags absent.
    assert(voca_update_chord(&s, VOCA_OTHER_MODIFIER, false, false, 3) == 0);
    assert(s.fn && s.control && s.held);
    // Ten seconds of held-state events (virtual nanosecond event timestamps).
    for (uint64_t t = 4; t <= 10000000004ULL; t += 100000000ULL) {
        assert(voca_update_chord(&s, VOCA_OTHER_MODIFIER, false, false, t) == 0);
        assert(s.held);
    }
    assert(voca_update_chord(&s, VOCA_CONTROL, false, true, 10000000005ULL) == 0);
    // An older relevant event cannot regress state.
    assert(voca_update_chord(&s, VOCA_CONTROL, false, false, 1) == 0);
    assert(voca_update_chord(&s, VOCA_CONTROL, false, false, 10000000006ULL) == -1);
    assert(voca_update_chord(&s, VOCA_CONTROL, false, false, 10000000007ULL) == 0);
    assert(voca_update_chord(&s, VOCA_FN, false, false, 10000000008ULL) == 0);

    // Control first; absent Control on the Fn event isn't a Control release.
    s = (VocaFnControlState){0};
    assert(voca_update_chord(&s, VOCA_CONTROL, false, true, 1) == 0);
    assert(voca_update_chord(&s, VOCA_FN, true, false, 2) == 1);
    assert(voca_update_chord(&s, VOCA_FN, true, false, 3) == 0);
    assert(voca_update_chord(&s, VOCA_FN, false, false, 4) == -1);
    assert(voca_update_chord(&s, VOCA_FN, false, false, 5) == 0);
    // Fn-like flags on unrelated events cannot arm the chord.
    assert(voca_update_chord(&s, VOCA_OTHER_MODIFIER, true, true, 6) == 0);
    // Rapid sessions with Control held: exactly one down/up each.
    for (uint64_t t = 7; t < 207; t += 2) {
        assert(voca_update_chord(&s, VOCA_FN, true, true, t) == 1);
        assert(voca_update_chord(&s, VOCA_FN, false, true, t + 1) == -1);
    }
    // Tap disruption reset cannot re-arm from an unrelated flag snapshot.
    s = (VocaFnControlState){0};
    assert(voca_update_chord(&s, VOCA_OTHER_MODIFIER, true, true, 1) == 0);
    assert(voca_update_chord(&s, VOCA_CONTROL, true, true, 2) == 0);
    puts("Fn + Control tests passed: key orders, 10s hold, releases, synthetic flags, duplicates, stale events, rapid sessions");
    return 0;
}
