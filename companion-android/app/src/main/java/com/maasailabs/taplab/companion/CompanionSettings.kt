package com.maasailabs.taplab.companion

import android.content.Context

object CompanionSettings {
    const val DEFAULT_AUTO_START_ON_BOOT_ENABLED = true
    const val DEFAULT_TAP_CODE_ENABLED = true
    const val DEFAULT_INDEX_DOUBLE_TAP_ENABLED = true
    const val DEFAULT_MIDDLE_DOUBLE_TAP_ENABLED = true
    const val DEFAULT_DOUBLE_TAP_WINDOW_MS = 275L
    const val MIN_DOUBLE_TAP_WINDOW_MS = 150L
    const val MAX_DOUBLE_TAP_WINDOW_MS = 500L
    const val DEFAULT_SCROLL_INJECTION_ENABLED = true
    const val DEFAULT_AIR_MOUSE_THUMB_MIDDLE_OVERRIDE_ENABLED = false
    const val DEFAULT_TAP_CODE_THUMB_INDEX_CLICK_ENABLED = true
    const val DEFAULT_TAP_CODE_THUMB_MIDDLE_MEDIA_ENABLED = true

    // Keyboard-mode (non-AirMouse) chord gestures use their own double-tap
    // configuration so cursor-mode tuning cannot change click latency while
    // typing. Off by default to keep chord clicks immediate.
    const val DEFAULT_TAP_CODE_CHORD_DOUBLE_TAP_ENABLED = false
    const val DEFAULT_TAP_CODE_CHORD_DOUBLE_TAP_WINDOW_MS = 275L

    // The Tap Strap 2 firmware reports the optical-glider "surface mouse" as
    // the MULTIMEDIA profile, the same state used when the profile is selected
    // as a media remote. Opt in to reclaim it for cursor gestures; off keeps
    // the firmware's native Multimedia HID controls.
    const val DEFAULT_SURFACE_MOUSE_MODE_ENABLED = false
    const val DEFAULT_SURFACE_MOUSE_INDEX_CLICK_ENABLED = true
    const val DEFAULT_SURFACE_MOUSE_MIDDLE_RIGHT_CLICK_ENABLED = false

    fun autoStartOnBootEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_AUTO_START_ON_BOOT_ENABLED,
            DEFAULT_AUTO_START_ON_BOOT_ENABLED
        )
    }

    fun setAutoStartOnBootEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_AUTO_START_ON_BOOT_ENABLED, enabled)
            .apply()
    }

    fun tapCodeEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_TAP_CODE_ENABLED,
            DEFAULT_TAP_CODE_ENABLED
        )
    }

    fun setTapCodeEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_TAP_CODE_ENABLED, enabled)
            .apply()
    }

    fun indexDoubleTapEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_INDEX_DOUBLE_TAP_ENABLED,
            DEFAULT_INDEX_DOUBLE_TAP_ENABLED
        )
    }

    fun setIndexDoubleTapEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_INDEX_DOUBLE_TAP_ENABLED, enabled)
            .apply()
    }

    fun middleDoubleTapEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_MIDDLE_DOUBLE_TAP_ENABLED,
            DEFAULT_MIDDLE_DOUBLE_TAP_ENABLED
        )
    }

    fun setMiddleDoubleTapEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_MIDDLE_DOUBLE_TAP_ENABLED, enabled)
            .apply()
    }

    fun doubleTapWindowMs(context: Context): Long {
        val storedValue = preferences(context).getLong(
            KEY_DOUBLE_TAP_WINDOW_MS,
            DEFAULT_DOUBLE_TAP_WINDOW_MS
        )
        return storedValue.coerceIn(
            MIN_DOUBLE_TAP_WINDOW_MS,
            MAX_DOUBLE_TAP_WINDOW_MS
        )
    }

    fun setDoubleTapWindowMs(context: Context, windowMs: Long) {
        preferences(context)
            .edit()
            .putLong(
                KEY_DOUBLE_TAP_WINDOW_MS,
                windowMs.coerceIn(
                    MIN_DOUBLE_TAP_WINDOW_MS,
                    MAX_DOUBLE_TAP_WINDOW_MS
                )
            )
            .apply()
    }

    fun scrollInjectionEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_SCROLL_INJECTION_ENABLED,
            DEFAULT_SCROLL_INJECTION_ENABLED
        )
    }

    fun setScrollInjectionEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_SCROLL_INJECTION_ENABLED, enabled)
            .apply()
    }

    fun airMouseThumbMiddleOverrideEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_AIR_MOUSE_THUMB_MIDDLE_OVERRIDE_ENABLED,
            DEFAULT_AIR_MOUSE_THUMB_MIDDLE_OVERRIDE_ENABLED
        )
    }

    fun setAirMouseThumbMiddleOverrideEnabled(
        context: Context,
        enabled: Boolean
    ) {
        preferences(context)
            .edit()
            .putBoolean(KEY_AIR_MOUSE_THUMB_MIDDLE_OVERRIDE_ENABLED, enabled)
            .apply()
    }

    fun tapCodeThumbIndexClickEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_TAP_CODE_THUMB_INDEX_CLICK_ENABLED,
            DEFAULT_TAP_CODE_THUMB_INDEX_CLICK_ENABLED
        )
    }

    fun setTapCodeThumbIndexClickEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_TAP_CODE_THUMB_INDEX_CLICK_ENABLED, enabled)
            .apply()
    }

    fun tapCodeThumbMiddleMediaEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_TAP_CODE_THUMB_MIDDLE_MEDIA_ENABLED,
            DEFAULT_TAP_CODE_THUMB_MIDDLE_MEDIA_ENABLED
        )
    }

    fun setTapCodeThumbMiddleMediaEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_TAP_CODE_THUMB_MIDDLE_MEDIA_ENABLED, enabled)
            .apply()
    }

    fun tapCodeChordDoubleTapEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_TAP_CODE_CHORD_DOUBLE_TAP_ENABLED,
            DEFAULT_TAP_CODE_CHORD_DOUBLE_TAP_ENABLED
        )
    }

    fun setTapCodeChordDoubleTapEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_TAP_CODE_CHORD_DOUBLE_TAP_ENABLED, enabled)
            .apply()
    }

    fun tapCodeChordDoubleTapWindowMs(context: Context): Long {
        val storedValue = preferences(context).getLong(
            KEY_TAP_CODE_CHORD_DOUBLE_TAP_WINDOW_MS,
            DEFAULT_TAP_CODE_CHORD_DOUBLE_TAP_WINDOW_MS
        )
        return storedValue.coerceIn(
            MIN_DOUBLE_TAP_WINDOW_MS,
            MAX_DOUBLE_TAP_WINDOW_MS
        )
    }

    fun setTapCodeChordDoubleTapWindowMs(context: Context, windowMs: Long) {
        preferences(context)
            .edit()
            .putLong(
                KEY_TAP_CODE_CHORD_DOUBLE_TAP_WINDOW_MS,
                windowMs.coerceIn(
                    MIN_DOUBLE_TAP_WINDOW_MS,
                    MAX_DOUBLE_TAP_WINDOW_MS
                )
            )
            .apply()
    }

    fun surfaceMouseModeEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_SURFACE_MOUSE_MODE_ENABLED,
            DEFAULT_SURFACE_MOUSE_MODE_ENABLED
        )
    }

    fun setSurfaceMouseModeEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_SURFACE_MOUSE_MODE_ENABLED, enabled)
            .apply()
    }

    fun surfaceMouseIndexClickEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_SURFACE_MOUSE_INDEX_CLICK_ENABLED,
            DEFAULT_SURFACE_MOUSE_INDEX_CLICK_ENABLED
        )
    }

    fun setSurfaceMouseIndexClickEnabled(context: Context, enabled: Boolean) {
        preferences(context)
            .edit()
            .putBoolean(KEY_SURFACE_MOUSE_INDEX_CLICK_ENABLED, enabled)
            .apply()
    }

    fun surfaceMouseMiddleRightClickEnabled(context: Context): Boolean {
        return preferences(context).getBoolean(
            KEY_SURFACE_MOUSE_MIDDLE_RIGHT_CLICK_ENABLED,
            DEFAULT_SURFACE_MOUSE_MIDDLE_RIGHT_CLICK_ENABLED
        )
    }

    fun setSurfaceMouseMiddleRightClickEnabled(
        context: Context,
        enabled: Boolean
    ) {
        preferences(context)
            .edit()
            .putBoolean(KEY_SURFACE_MOUSE_MIDDLE_RIGHT_CLICK_ENABLED, enabled)
            .apply()
    }
    private fun preferences(context: Context) = context.applicationContext
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private const val PREFERENCES_NAME = "taplab_companion_settings"
    private const val KEY_AUTO_START_ON_BOOT_ENABLED = "auto_start_on_boot_enabled"
    private const val KEY_TAP_CODE_ENABLED = "tap_code_enabled"
    private const val KEY_INDEX_DOUBLE_TAP_ENABLED = "index_double_tap_enabled"
    private const val KEY_MIDDLE_DOUBLE_TAP_ENABLED = "middle_double_tap_enabled"
    private const val KEY_DOUBLE_TAP_WINDOW_MS = "double_tap_window_ms"
    private const val KEY_SCROLL_INJECTION_ENABLED = "scroll_injection_enabled"
    private const val KEY_AIR_MOUSE_THUMB_MIDDLE_OVERRIDE_ENABLED =
        "air_mouse_thumb_middle_override_enabled"
    private const val KEY_TAP_CODE_THUMB_INDEX_CLICK_ENABLED =
        "tap_code_thumb_index_click_enabled"
    private const val KEY_TAP_CODE_THUMB_MIDDLE_MEDIA_ENABLED =
        "tap_code_thumb_middle_media_enabled"
    private const val KEY_TAP_CODE_CHORD_DOUBLE_TAP_ENABLED =
        "tap_code_chord_double_tap_enabled"
    private const val KEY_TAP_CODE_CHORD_DOUBLE_TAP_WINDOW_MS =
        "tap_code_chord_double_tap_window_ms"
    private const val KEY_SURFACE_MOUSE_MODE_ENABLED =
        "surface_mouse_mode_enabled"
    private const val KEY_SURFACE_MOUSE_INDEX_CLICK_ENABLED =
        "surface_mouse_index_click_enabled"
    private const val KEY_SURFACE_MOUSE_MIDDLE_RIGHT_CLICK_ENABLED =
        "surface_mouse_middle_right_click_enabled"
}
