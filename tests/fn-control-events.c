// Exercise the actual CGEvent callback without posting any events to the Mac.
#define main voca_helper_main
#include "../native/fn-control.c"
#undef main
#include <assert.h>

static void modifier(CGKeyCode key, CGEventFlags flags, uint64_t timestamp) {
    CGEventRef event = CGEventCreate(NULL);
    assert(event);
    CGEventSetType(event, kCGEventFlagsChanged);
    CGEventSetIntegerValueField(event, kCGKeyboardEventKeycode, key);
    CGEventSetFlags(event, flags);
    CGEventSetTimestamp(event, timestamp);
    assert(handle_event(NULL, kCGEventFlagsChanged, event, NULL) == event);
    CFRelease(event);
}

int main(void) {
    modifier(kVK_Function, kCGEventFlagMaskSecondaryFn, 1);
    modifier(kVK_Control, kCGEventFlagMaskControl, 2);
    assert(state.held);
    // Exact relevant flags pattern from uiohook's synthetic Command+C.
    modifier(kVK_Command, kCGEventFlagMaskCommand, 3);
    modifier(kVK_Command, 0, 4);
    assert(state.fn && state.control && state.held);
    modifier(kVK_Control, 0, 5);
    assert(!state.held && state.fn);
    modifier(kVK_Function, 0, 6);
    // Reverse order, right Control; release Fn while Control remains held.
    modifier(kVK_RightControl, kCGEventFlagMaskControl, 7);
    modifier(kVK_Function, kCGEventFlagMaskSecondaryFn, 8);
    assert(state.held);
    modifier(kVK_Function, 0, 9);
    assert(!state.held && state.control);
    modifier(kVK_RightControl, 0, 10);
    assert(!state.control);
    release_gate = (VocaReleaseGate){true, true, true};
    modifier(kVK_Control, kCGEventFlagMaskControl, 11);
    modifier(kVK_Function, kCGEventFlagMaskSecondaryFn, 12);
    assert(!state.held);
    modifier(kVK_Command, 0, 13);
    assert(release_gate.waiting);
    modifier(kVK_Function, 0, 14);
    modifier(kVK_Control, 0, 15);
    assert(!release_gate.waiting);
    modifier(kVK_Function, kCGEventFlagMaskSecondaryFn, 16);
    modifier(kVK_Control, kCGEventFlagMaskControl, 17);
    assert(state.held);
    handle_event(NULL, kCGEventTapDisabledByTimeout, NULL, NULL);
    assert(unavailable && !state.held);
    // A disabled tap never emits a normal release or accepts another chord.
    modifier(kVK_Function, kCGEventFlagMaskSecondaryFn, 18);
    assert(!state.held);
    unavailable = false;
    handle_event(NULL, kCGEventTapDisabledByUserInput, NULL, NULL);
    assert(unavailable);
    puts("Native CGEvent callback tests passed (no global event injection)");
    return 0;
}
