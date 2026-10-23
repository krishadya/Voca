#ifndef VOCA_FN_CONTROL_STATE_H
#define VOCA_FN_CONTROL_STATE_H
#include <stdbool.h>
#include <stdint.h>

// Only a physical Fn flagsChanged event can arm the chord. The Fn flag on
// arrow/function-key events alone must never be interpreted as a held Fn key.
typedef enum { VOCA_OTHER_MODIFIER, VOCA_FN, VOCA_CONTROL } VocaModifier;
typedef struct { bool fn; bool control; bool held; uint64_t timestamp; } VocaFnControlState;

static int voca_update_chord(VocaFnControlState *state, VocaModifier modifier,
                             bool fn_flag, bool control_flag, uint64_t timestamp) {
    // Synthetic Command+C carries Command-only flags even while the physical
    // Fn/Control keys remain held. Only update the modifier named by the keycode.
    if (modifier == VOCA_OTHER_MODIFIER || timestamp < state->timestamp) return 0;
    state->timestamp = timestamp;
    if (modifier == VOCA_FN) state->fn = fn_flag;
    if (modifier == VOCA_CONTROL) state->control = control_flag;
    // Aggregate Control on a Control event handles either/both Control keys.
    bool held = state->fn && state->control;
    if (held == state->held) return 0;
    state->held = held;
    return held ? 1 : -1;
}
#endif
