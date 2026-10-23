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

static void emit_transition(int transition) {
    if (transition == 1) puts("PTT_DOWN");
    if (transition == -1) puts("PTT_UP");
}

static CGEventRef handle_event(CGEventTapProxy proxy, CGEventType type,
                               CGEventRef event, void *context) {
    (void)proxy;
    (void)context;
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (diagnostics) puts("diagnostic tap-reset");
        if (state.held) emit_transition(-1);
        state = (VocaFnControlState){0};
        CGEventTapEnable(tap, true);
        return event;
    }
    if (type != kCGEventFlagsChanged) return event;
    CGKeyCode key = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    CGEventFlags flags = CGEventGetFlags(event);
    VocaModifier modifier = key == kVK_Function ? VOCA_FN :
        (key == kVK_Control || key == kVK_RightControl) ? VOCA_CONTROL : VOCA_OTHER_MODIFIER;
    int transition = voca_update_chord(&state, modifier,
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
    if (getppid() != parent_pid || !CGEventTapIsEnabled(tap)) {
        CFRunLoopStop(CFRunLoopGetCurrent());
        return;
    }
    puts("alive");
}

int main(int argc, char **argv) {
    diagnostics = argc == 2 && strcmp(argv[1], "--diagnostics") == 0;
    setvbuf(stdout, NULL, _IOLBF, 0);
    parent_pid = getppid();
    tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
        kCGEventTapOptionListenOnly, CGEventMaskBit(kCGEventFlagsChanged), handle_event, NULL);
    if (!tap) return 1;
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
    if (state.held) emit_transition(-1);
    CFRelease(timer);
    CFRelease(source);
    CFRelease(tap);
    return 0;
}
