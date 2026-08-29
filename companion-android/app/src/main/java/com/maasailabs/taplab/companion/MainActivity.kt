package com.maasailabs.taplab.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.widget.ImageViewCompat
import androidx.core.content.res.ResourcesCompat
import android.content.res.ColorStateList
import com.google.android.material.button.MaterialButton
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.slider.Slider

class MainActivity : AppCompatActivity() {
    private lateinit var pageScrollView: ScrollView
    private lateinit var statusDot: ImageView
    private lateinit var statusPillText: TextView
    private lateinit var statusDetail: TextView
    private lateinit var tapCodeStateText: TextView
    private lateinit var logView: TextView
    private lateinit var doubleTapWindowLabel: TextView

    private val logLines = ArrayDeque<String>()
    private var logByteCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bindViews()
        populateStaticText()
        wireServiceControls()
        wireTapCodeControls()
        wireAirMouseSettings()
        wireTapCodeModeControls()
        wireDiagnostics()

        val persistedLog = DiagnosticLog.read(applicationContext)
        if (persistedLog.isEmpty()) {
            appendLog("TapLab Companion ready.")
        } else {
            loadPersistedLog(persistedLog)
        }
        requestRequiredPermissions()

        TapOverrideService.logSink = { formattedLine ->
            runOnUiThread {
                val message = formattedLine.substringAfter(' ', formattedLine)
                statusDetail.text = message
                when {
                    message.startsWith("Tap Code typing ON") -> renderTapCodeState(true)
                    message.startsWith("Tap Code typing OFF") -> renderTapCodeState(false)
                }
                appendFormattedLogLine(formattedLine)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        renderServiceState()
        renderTapCodeState(tapCodeEnabledForDisplay())
    }

    override fun onDestroy() {
        TapOverrideService.logSink = null
        super.onDestroy()
    }

    private fun bindViews() {
        pageScrollView = findViewById(R.id.page_scroll)
        statusDot = findViewById(R.id.status_dot)
        statusPillText = findViewById(R.id.status_pill_text)
        statusDetail = findViewById(R.id.status_detail)
        tapCodeStateText = findViewById(R.id.tapcode_state_text)
        logView = findViewById(R.id.log_view)
        doubleTapWindowLabel = findViewById(R.id.label_double_tap_window)
    }

    private fun populateStaticText() {
        findViewById<TextView>(R.id.text_airmouse_steps).text = AIRMOUSE_STEPS
        findViewById<TextView>(R.id.text_airmouse_note).text = AIRMOUSE_NOTE
        findViewById<TextView>(R.id.text_grid_reference).text = GRID_REFERENCE
        findViewById<TextView>(R.id.text_log_note).text = LOG_NOTE
    }

    private fun wireServiceControls() {
        findViewById<MaterialButton>(R.id.btn_start).setOnClickListener {
            ContextCompat.startForegroundService(
                this,
                Intent(this, TapOverrideService::class.java)
            )
            statusDetail.text = "Starting override service…"
            renderServiceState(forcedRunning = true)
        }

        findViewById<MaterialButton>(R.id.btn_stop).setOnClickListener {
            stopService(Intent(this, TapOverrideService::class.java))
            statusDetail.text = "Override service stopped."
            renderServiceState(forcedRunning = false)
            renderTapCodeState(false)
        }

        findViewById<MaterialSwitch>(R.id.switch_autostart).apply {
            isChecked = CompanionSettings.autoStartOnBootEnabled(applicationContext)
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setAutoStartOnBootEnabled(
                    applicationContext,
                    enabled
                )
                appendLog("Setting changed: auto-start after reboot=$enabled")
            }
        }
    }

    private fun wireTapCodeControls() {
        findViewById<MaterialButton>(R.id.btn_toggle_tapcode).setOnClickListener {
            ContextCompat.startForegroundService(
                this,
                Intent(this, TapOverrideService::class.java).apply {
                    action = TapOverrideService.ACTION_TOGGLE_TAPCODE
                }
            )
            statusDetail.text = "Toggling Tap Code typing…"
        }

        findViewById<MaterialButton>(R.id.btn_trainer).setOnClickListener {
            startActivity(Intent(this, TapCodeTrainerActivity::class.java))
        }
    }

    private fun wireAirMouseSettings() {
        findViewById<MaterialSwitch>(R.id.switch_thumb_middle_override).apply {
            isChecked = CompanionSettings.airMouseThumbMiddleOverrideEnabled(
                applicationContext
            )
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setAirMouseThumbMiddleOverrideEnabled(
                    applicationContext,
                    enabled
                )
                val behavior = if (enabled) {
                    "custom media/back enabled; native profile may also cycle"
                } else {
                    "native profile cycle preserved"
                }
                appendLog(
                    "Setting changed: AirMouse thumb-middle override=$enabled " +
                        "($behavior)"
                )
                TapOverrideService.onSettingsChanged()
            }
        }

        findViewById<MaterialSwitch>(R.id.switch_index_double).apply {
            isChecked = CompanionSettings.indexDoubleTapEnabled(applicationContext)
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setIndexDoubleTapEnabled(applicationContext, enabled)
                val behavior = if (enabled) {
                    "right-click double tap enabled"
                } else {
                    "instant left click"
                }
                appendLog(
                    "Setting changed: thumb-index double tap=$enabled ($behavior)"
                )
                TapOverrideService.onSettingsChanged()
            }
        }

        findViewById<MaterialSwitch>(R.id.switch_middle_double).apply {
            isChecked = CompanionSettings.middleDoubleTapEnabled(applicationContext)
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setMiddleDoubleTapEnabled(applicationContext, enabled)
                val behavior = if (enabled) {
                    "Back double tap enabled"
                } else {
                    "instant media play/pause"
                }
                appendLog(
                    "Setting changed: thumb-middle double tap=$enabled ($behavior)"
                )
                TapOverrideService.onSettingsChanged()
            }
        }

        var persistedDoubleTapWindow =
            CompanionSettings.doubleTapWindowMs(applicationContext)
        renderDoubleTapWindowLabel(persistedDoubleTapWindow)

        findViewById<Slider>(R.id.slider_double_tap_window).apply {
            valueFrom = CompanionSettings.MIN_DOUBLE_TAP_WINDOW_MS.toFloat()
            valueTo = CompanionSettings.MAX_DOUBLE_TAP_WINDOW_MS.toFloat()
            value = persistedDoubleTapWindow.toFloat()

            addOnChangeListener { _, sliderValue, fromUser ->
                if (fromUser) {
                    renderDoubleTapWindowLabel(sliderValue.toLong())
                }
            }

            addOnSliderTouchListener(
                object : Slider.OnSliderTouchListener {
                    override fun onStartTrackingTouch(slider: Slider) = Unit

                    override fun onStopTrackingTouch(slider: Slider) {
                        val windowMs = slider.value.toLong()
                        if (windowMs == persistedDoubleTapWindow) return

                        persistedDoubleTapWindow = windowMs
                        CompanionSettings.setDoubleTapWindowMs(
                            applicationContext,
                            windowMs
                        )
                        appendLog("Setting changed: double-tap window=${windowMs}ms")
                        TapOverrideService.onSettingsChanged()
                    }
                }
            )
        }

        findViewById<MaterialSwitch>(R.id.switch_scroll).apply {
            isChecked = CompanionSettings.scrollInjectionEnabled(applicationContext)
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setScrollInjectionEnabled(
                    applicationContext,
                    enabled
                )
                appendLog("Setting changed: scroll injection=$enabled")
                TapOverrideService.onSettingsChanged()
            }
        }
    }

    private fun wireTapCodeModeControls() {
        findViewById<MaterialSwitch>(R.id.switch_chord_click).apply {
            isChecked = CompanionSettings.tapCodeThumbIndexClickEnabled(
                applicationContext
            )
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setTapCodeThumbIndexClickEnabled(
                    applicationContext,
                    enabled
                )
                appendLog(
                    "Setting changed: non-AirMouse Thumb+Index chord click=$enabled"
                )
                TapOverrideService.onSettingsChanged()
            }
        }

        findViewById<MaterialSwitch>(R.id.switch_chord_media).apply {
            isChecked = CompanionSettings.tapCodeThumbMiddleMediaEnabled(
                applicationContext
            )
            setOnCheckedChangeListener { _, enabled ->
                CompanionSettings.setTapCodeThumbMiddleMediaEnabled(
                    applicationContext,
                    enabled
                )
                appendLog(
                    "Setting changed: non-AirMouse Thumb+Middle chord media=$enabled"
                )
                TapOverrideService.onSettingsChanged()
            }
        }
    }

    private fun wireDiagnostics() {
        findViewById<MaterialButton>(R.id.btn_test_root).setOnClickListener { button ->
            button.isEnabled = false
            Thread {
                val result = RootInjector.testRoot()
                runOnUiThread {
                    appendLog("Root test: $result")
                    button.isEnabled = true
                }
            }.start()
        }

        findViewById<MaterialButton>(R.id.btn_clear_log).setOnClickListener {
            clearLog()
            appendLog("Log cleared.")
        }
    }

    private fun renderDoubleTapWindowLabel(windowMs: Long) {
        doubleTapWindowLabel.text = "Double-tap window · ${windowMs} ms"
    }

    private fun renderServiceState(forcedRunning: Boolean? = null) {
        val running = forcedRunning ?: TapOverrideService.isRunning()
        val training = TapOverrideService.isTraining()

        val (label, colorRes) = when {
            training -> "Trainer active" to R.color.status_warning
            running -> "Running" to R.color.status_active
            else -> "Stopped" to R.color.status_inactive
        }

        statusPillText.text = label
        ImageViewCompat.setImageTintList(
            statusDot,
            ColorStateList.valueOf(
                ResourcesCompat.getColor(resources, colorRes, theme)
            )
        )

        if (statusDetail.text.isNullOrBlank()) {
            statusDetail.text = if (running) {
                "Override service is active and listening for Tap input."
            } else {
                "Override service is not running."
            }
        }
    }

    private fun renderTapCodeState(enabled: Boolean) {
        tapCodeStateText.text = if (enabled) "ON" else "OFF"
        tapCodeStateText.setTextColor(
            ResourcesCompat.getColor(
                resources,
                if (enabled) R.color.status_active else R.color.status_inactive,
                theme
            )
        )
    }

    private fun appendLog(message: String) {
        val formattedLine = DiagnosticLog.append(applicationContext, message)
        appendFormattedLogLine(formattedLine)
    }

    private fun appendFormattedLogLine(line: String) {
        val followLogTail = isNearPageBottom()
        logLines.addLast(line)
        logByteCount += persistedByteCount(line)
        trimVisibleLog()
        renderLog(followLogTail)
    }

    private fun loadPersistedLog(persistedLog: String) {
        logLines.clear()
        logByteCount = 0
        persistedLog
            .lineSequence()
            .filter(String::isNotEmpty)
            .forEach { line ->
                logLines.addLast(line)
                logByteCount += persistedByteCount(line)
            }
        trimVisibleLog()
        // Restoring history must not hide the controls/settings at page top.
        renderLog(followLogTail = false)
    }

    private fun trimVisibleLog() {
        while (
            logLines.size > MAX_LOG_LINES ||
            logByteCount > MAX_LOG_BYTES
        ) {
            val removed = logLines.removeFirstOrNull() ?: break
            logByteCount -= persistedByteCount(removed)
        }
    }

    private fun persistedByteCount(line: String): Int {
        return line.toByteArray(Charsets.UTF_8).size + 1
    }

    private fun renderLog(followLogTail: Boolean = true) {
        logView.text = if (logLines.isEmpty()) {
            ""
        } else {
            logLines.joinToString(separator = "\n", postfix = "\n")
        }
        if (followLogTail) {
            pageScrollView.post {
                pageScrollView.fullScroll(ScrollView.FOCUS_DOWN)
            }
        }
    }

    private fun isNearPageBottom(): Boolean {
        val content = pageScrollView.getChildAt(0) ?: return false
        val threshold = (48 * resources.displayMetrics.density).toInt()
        return pageScrollView.scrollY + pageScrollView.height >=
            content.height - threshold
    }

    private fun clearLog() {
        DiagnosticLog.clear(applicationContext)
        logLines.clear()
        logByteCount = 0
        logView.text = ""
    }

    private fun tapCodeEnabledForDisplay(): Boolean {
        return if (TapOverrideService.isRunning()) {
            TapOverrideService.isTapCodeEnabled()
        } else {
            CompanionSettings.tapCodeEnabled(applicationContext)
        }
    }

    private fun requestRequiredPermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions += Manifest.permission.BLUETOOTH_CONNECT
            permissions += Manifest.permission.BLUETOOTH_SCAN
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }

        val missingPermissions = permissions.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missingPermissions.isNotEmpty()) {
            requestPermissions(missingPermissions.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    private companion object {
        const val PERMISSION_REQUEST_CODE = 100
        const val MAX_LOG_LINES = 500
        const val MAX_LOG_BYTES = 64 * 1024

        val AIRMOUSE_STEPS = """
            1. Align the thumb ring with your thumbnail.
            2. Hold the hand edge-on like a handshake. Thumb and index are vertically stacked: thumb directly ABOVE the index, both parallel and pointing forward — like the two horizontal strokes of an equals sign. Middle, ring, and pinky stay relaxed below the index.
            3. Hold steady until one buzz.
            4. In TapManager, confirm the latest firmware and that AirMouse is Enabled.
            5. Thumb-to-middle cycles submodes: 1 buzz AirMouse, 2 Multimedia, 3 TV.

            Exit: hold your palm horizontal to the floor, or place the glider on a surface and move it slightly.
        """.trimIndent()

        val AIRMOUSE_NOTE = "Tap Strap 2 firmware controls physical AirMouse " +
            "entry; this app cannot force it through the official SDK."

        val GRID_REFERENCE = """
            GRID     I   M   R   P  RP
            I        a   b   c   d   e
            M        f   g   h   i   j
            R        k   l   m   n   o
            P        p   q   r   s   t
            RP       u   v   w   x   y

            IM            space / cancel
            MR + I        z
            MR + M        backspace
            MR + R        enter
            MR + P        .
            MR + RP       ,
            MR + MR       toggle Tap Code off
        """.trimIndent()

        val LOG_NOTE = "[Regular] marks SDK-visible events around stock mode. " +
            "The Tap SDK does not expose individual stock HID keystrokes; " +
            "capturing them would require keylogging, which this app " +
            "intentionally does not do."
    }
}
