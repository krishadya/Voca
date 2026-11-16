#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>
#include "fn-control-state.h"

static CFMachPortRef tap;
static VocaFnControlState state = {0};
static pid_t parent_pid;
static bool diagnostics;
static bool unavailable;
static VocaReleaseGate release_gate = {0};

static void invalidate_tap(void) {
    if (unavailable) return;
    unavailable = true;
    state = (VocaFnControlState){0};
    puts("unavailable");
    CFRunLoopStop(CFRunLoopGetCurrent());
}

static void emit_transition(int transition) {
    if (transition == 1) puts("PTT_DOWN");
    if (transition == -1) puts("PTT_UP");
}

static CGEventRef handle_event(CGEventTapProxy proxy, CGEventType type,
                               CGEventRef event, void *context) {
    (void)proxy;
    (void)context;
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (diagnostics) puts("diagnostic tap-disabled");
        invalidate_tap(); // Parent recreates the helper; never submit a partial clip.
        return event;
    }
    if (type != kCGEventFlagsChanged) return event;
    if (unavailable) return event;
    CGKeyCode key = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    CGEventFlags flags = CGEventGetFlags(event);
    VocaModifier modifier = key == kVK_Function ? VOCA_FN :
        (key == kVK_Control || key == kVK_RightControl) ? VOCA_CONTROL : VOCA_OTHER_MODIFIER;
    bool wait_for_release = voca_wait_for_release(&release_gate, modifier,
        (flags & kCGEventFlagMaskSecondaryFn) != 0,
        (flags & kCGEventFlagMaskControl) != 0);
    int transition = wait_for_release ? 0 : voca_update_chord(&state, modifier,
        (flags & kCGEventFlagMaskSecondaryFn) != 0,
        (flags & kCGEventFlagMaskControl) != 0,
        CGEventGetTimestamp(event));
    // Only modifier metadata, never characters or unrelated keyboard events.
    bool relevant = modifier != VOCA_OTHER_MODIFIER || ((state.fn || state.control) &&
        (key == kVK_Command || key == kVK_RightCommand || key == kVK_Option ||
         key == kVK_RightOption || key == kVK_Shift || key == kVK_RightShift));
    if (diagnostics && relevant) {
        struct timeval now;
        gettimeofday(&now, NULL);
        printf("diagnostic timeMs=%lld keycode=%u flags=0x%llx hidFlags=0x%llx "
               "eventNs=%llu fn=%d control=%d held=%d transition=%d\n",
            (long long)now.tv_sec * 1000 + now.tv_usec / 1000, key,
            (unsigned long long)flags,
            (unsigned long long)CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState),
            (unsigned long long)CGEventGetTimestamp(event),
            state.fn, state.control, state.held, transition);
    }
    emit_transition(transition);
    // Listen-only: never consume or rewrite keyboard events, or activate a window.
    return event;
}

static void heartbeat(CFRunLoopTimerRef timer, void *context) {
    (void)timer;
    (void)context;
    if (getppid() != parent_pid) {
        CFRunLoopStop(CFRunLoopGetCurrent());
        return;
    }
    if (!CGEventTapIsEnabled(tap)) { invalidate_tap(); return; }
    puts("alive");
}

int main(int argc, char **argv) {
    diagnostics = argc == 2 && strcmp(argv[1], "--diagnostics") == 0;
    setvbuf(stdout, NULL, _IOLBF, 0);
    parent_pid = getppid();
    tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
        kCGEventTapOptionListenOnly, CGEventMaskBit(kCGEventFlagsChanged), handle_event, NULL);
    if (!tap) return 1;
    // Keys held across sleep/startup must be released before a fresh chord.
    CGEventFlags physical = CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState);
    release_gate.fn = (physical & kCGEventFlagMaskSecondaryFn) != 0;
    release_gate.control = (physical & kCGEventFlagMaskControl) != 0;
    release_gate.waiting = release_gate.fn || release_gate.control;
    if (diagnostics && release_gate.waiting) puts("diagnostic startup-waiting-for-modifier-release");
    CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
    if (!source) { CFRelease(tap); return 1; }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    if (!CGEventTapIsEnabled(tap)) { CFRelease(source); CFRelease(tap); return 1; }
    CFRunLoopTimerRef timer = CFRunLoopTimerCreate(kCFAllocatorDefault,
        CFAbsoluteTimeGetCurrent() + 1, 1, 0, 0, heartbeat, NULL);
    CFRunLoopAddTimer(CFRunLoopGetCurrent(), timer, kCFRunLoopCommonModes);
    puts("ready");
    CFRunLoopRun();
    state = (VocaFnControlState){0};
    CFRelease(timer);
    CFRelease(source);
    CFRelease(tap);
    return 0;
}
