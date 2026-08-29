package com.maasailabs.taplab.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.tapwithus.sdk.TapListener
import com.tapwithus.sdk.TapSdk
import com.tapwithus.sdk.TapSdkFactory
import com.tapwithus.sdk.airmouse.AirMousePacket
import com.tapwithus.sdk.mode.RawSensorData
import com.tapwithus.sdk.mode.TapInputMode
import com.tapwithus.sdk.mouse.MousePacket

class TapOverrideService : Service() {
    private lateinit var sdk: TapSdk
    private lateinit var injectorThread: HandlerThread
    private lateinit var injectorHandler: Handler
    private var lastTapIdentifier: String? = null
    private var airMouseMotionPacketCount = 0L
    private var lastMouseProximity: Int? = null
    private var lastRawSensorLogMs = 0L
    private var suppressedRawSensorPackets = 0

    private val tapCodeDecoder by lazy {
        TapCodeDecoder(onEvent = ::handleTapCodeEvent)
    }

    private val tapCodeTick = object : Runnable {
        override fun run() {
            if (!decoderActive()) return
            tapCodeDecoder.tick(System.currentTimeMillis())
            injectorHandler.postDelayed(this, TAP_CODE_TICK_MS)
        }
    }

    private val leftClickDetector by lazy {
        DoubleTapDetector(
            name = "thumb-index",
            singleAction = RootInjector::clickLeft,
            doubleAction = RootInjector::clickRight
        )
    }
    private val mediaDetector by lazy {
        DoubleTapDetector(
            name = "thumb-middle",
            singleAction = { RootInjector.keyevent(MEDIA_PLAY_PAUSE_KEYCODE) },
            doubleAction = { RootInjector.keyevent(BACK_KEYCODE) }
        )
    }

    private val tapListener = object : TapListener {
        override fun onBluetoothTurnedOn() {
            log("Bluetooth turned on")
        }

        override fun onBluetoothTurnedOff() {
            log("Bluetooth turned off")
        }

        override fun onTapStartConnecting(tapIdentifier: String) {
            log("Tap connecting: $tapIdentifier")
        }

        override fun onTapConnected(tapIdentifier: String) {
            val tapCodeEnabled = isTapCodeEnabled()
            val training = isTraining()
            val airMouseEnabled = sdk.isTapInAirMouseState(tapIdentifier)
            log(
                "Tap connected: device=${shortDeviceId(tapIdentifier)} " +
                    "tapCode=$tapCodeEnabled training=$training airMouse=$airMouseEnabled"
            )

            injectorHandler.post {
                val eventDevice = RootInjector.discoverTapEventDevice()
                log(
                    "Post-connect event-node discovery for " +
                        "${shortDeviceId(tapIdentifier)}: ${eventDevice ?: "NOT FOUND"}"
                )
            }

            if (decoderActive()) {
                requestControllerWithMouseHidMode(
                    tapIdentifier,
                    if (training) "native trainer active" else "Tap Code enabled"
                )
            } else {
                requestTextMode(tapIdentifier, "Tap Code disabled")
                if (airMouseEnabled) {
                    requestControllerWithMouseHidMode(tapIdentifier, "AirMouse active")
                    log("AirMouse ON — override active")
                }
            }
        }

        override fun onTapDisconnected(tapIdentifier: String) {
            lastMouseProximity = null
            log("Tap disconnected: $tapIdentifier")
        }

        override fun onTapResumed(tapIdentifier: String) {
            log("Tap resumed: $tapIdentifier")
        }

        override fun onTapChanged(tapIdentifier: String) {
            log("Tap changed: device=${shortDeviceId(tapIdentifier)}")
        }

        override fun onTapInputReceived(
            tapIdentifier: String,
            data: Int,
            repeatData: Int
        ) {
            val tapCodeEnabled = isTapCodeEnabled()
            val training = isTraining()
            val decoderActive = decoderActive()
            val modeTag = when {
                training -> "[Trainer]"
                tapCodeEnabled -> "[TapCode]"
                else -> "[Regular]"
            }
            val outputDescription = if (decoderActive) {
                ""
            } else {
                " SDK callback while stock mode requested"
            }
            log(
                "$modeTag Tap input: device=${shortDeviceId(tapIdentifier)} raw=$data " +
                    "binary=${fiveBitBinary(data)} fingers=${fingerNames(data)} " +
                    "repeatData=$repeatData tapCode=$tapCodeEnabled " +
                    "training=$training$outputDescription"
            )
            if (!decoderActive) return

            if (tapCodeEnabled && !training && !sdk.isTapInAirMouseState(tapIdentifier)) {
                when {
                    data == THUMB_INDEX_CHORD &&
                        CompanionSettings.tapCodeThumbIndexClickEnabled(
                            applicationContext
                        ) -> {
                        log(
                            "ACTION immediate: non-AirMouse Thumb+Index chord -> LEFT click"
                        )
                        injectorHandler.post { RootInjector.clickLeft() }
                        return
                    }

                    data == THUMB_MIDDLE_CHORD &&
                        CompanionSettings.tapCodeThumbMiddleMediaEnabled(
                            applicationContext
                        ) -> {
                        log(
                            "ACTION immediate: non-AirMouse Thumb+Middle chord -> " +
                                "MEDIA PLAY/PAUSE"
                        )
                        injectorHandler.post {
                            RootInjector.keyevent(MEDIA_PLAY_PAUSE_KEYCODE)
                        }
                        return
                    }
                }
            }

            injectorHandler.post {
                if (!decoderActive()) return@post
                lastTapIdentifier = tapIdentifier
                tapCodeDecoder.feed(data, System.currentTimeMillis())
            }
        }

        override fun onTapShiftSwitchReceived(tapIdentifier: String, data: Int) {
            val modeTag = if (isTapCodeEnabled()) "[TapCode]" else "[Regular]"
            log(
                "$modeTag Tap shift switch: " +
                    "device=${shortDeviceId(tapIdentifier)} data=$data"
            )
        }

        override fun onMouseInputReceived(
            tapIdentifier: String,
            data: MousePacket
        ) {
            // Cursor motion emits dozens of packets per second. Counting rather
            // than logging them keeps gestures, clicks, and failures visible.
            airMouseMotionPacketCount += 1

            val proximity = data.proximity.getInt()
            val previousProximity = lastMouseProximity
            if (proximity != previousProximity) {
                log(
                    "[SurfaceMouse] proximity changed: " +
                        "old=${previousProximity?.toString() ?: "unknown"} " +
                        "new=$proximity device=${shortDeviceId(tapIdentifier)}"
                )
                lastMouseProximity = proximity
            }
        }

        override fun onAirMouseInputReceived(
            tapIdentifier: String,
            data: AirMousePacket
        ) {
            val gesture = data.gesture.getInt()
            val state = data.state.getInt()
            log(
                "[AirMouse] input: device=${shortDeviceId(tapIdentifier)} " +
                    "gesture=$gesture (${gestureName(gesture)}) state=$state " +
                    "raw=${bytesHex(gesture, state)}"
            )

            when (gesture) {
                AirMousePacket.AIR_MOUSE_GESTURE_INDEX_TO_THUMB_TOUCH -> {
                    if (
                        CompanionSettings.indexDoubleTapEnabled(applicationContext)
                    ) {
                        log("ACTION queued: thumb-index -> click detector")
                        leftClickDetector.onEvent()
                    } else {
                        injectorHandler.post {
                            leftClickDetector.cancel()
                            log(
                                "ACTION immediate: thumb-index -> LEFT click " +
                                    "(double tap disabled)"
                            )
                            RootInjector.clickLeft()
                        }
                    }
                }

                AirMousePacket.AIR_MOUSE_GESTURE_MIDDLE_TO_THUMB_TOUCH -> {
                    if (
                        !CompanionSettings.airMouseThumbMiddleOverrideEnabled(
                            applicationContext
                        )
                    ) {
                        log(
                            "[AirMouse] Thumb-middle reserved for native profile cycle " +
                                "(1 buzz AirMouse / 2 Multimedia / 3 TV); " +
                                "custom action disabled"
                        )
                        return
                    }

                    log(
                        "[AirMouse] WARNING: custom thumb-middle override enabled; " +
                            "native profile cycling may also occur"
                    )
                    if (
                        CompanionSettings.middleDoubleTapEnabled(applicationContext)
                    ) {
                        log("ACTION queued: thumb-middle -> click detector")
                        mediaDetector.onEvent()
                    } else {
                        injectorHandler.post {
                            mediaDetector.cancel()
                            log(
                                "ACTION immediate: thumb-middle -> MEDIA PLAY/PAUSE " +
                                    "(double tap disabled)"
                            )
                            RootInjector.keyevent(MEDIA_PLAY_PAUSE_KEYCODE)
                        }
                    }
                }

                AirMousePacket.AIR_MOUSE_GESTURE_UP_TWO_FINGERS -> {
                    if (
                        CompanionSettings.scrollInjectionEnabled(applicationContext)
                    ) {
                        log("ACTION queued: two-finger up -> scroll up")
                        injectorHandler.post { RootInjector.scroll(1) }
                    } else {
                        log("ACTION skipped: two-finger up -> scroll injection disabled")
                    }
                }

                AirMousePacket.AIR_MOUSE_GESTURE_DOWN_TWO_FINGERS -> {
                    if (
                        CompanionSettings.scrollInjectionEnabled(applicationContext)
                    ) {
                        log("ACTION queued: two-finger down -> scroll down")
                        injectorHandler.post { RootInjector.scroll(-1) }
                    } else {
                        log("ACTION skipped: two-finger down -> scroll injection disabled")
                    }
                }

                else -> log(
                    "AirMouse gesture observed with no mapped action: " +
                        "$gesture (${gestureName(gesture)})"
                )
            }
        }

        override fun onRawSensorInputReceived(
            tapIdentifier: String,
            rsData: RawSensorData
        ) {
            logRawSensorPacket(tapIdentifier, rsData)
        }

        override fun onTapChangedState(tapIdentifier: String, state: Int) {
            val stateName = tapStateName(state)
            lastMouseProximity = null
            log(
                "[Mode] Tap state changed: device=${shortDeviceId(tapIdentifier)} " +
                    "rawState=$state state=$stateName"
            )

            if (state != AIR_MOUSE_STATE) {
                logAirMouseMotionSummary()
            }

            when (state) {
                AIR_MOUSE_STATE -> {
                    airMouseMotionPacketCount = 0
                    requestControllerWithMouseHidMode(
                        tapIdentifier,
                        "native profile AIRMOUSE"
                    )
                    log(
                        "[Mode] Native AIRMOUSE profile active; override active " +
                            "(cursor-motion packet logging suppressed)"
                    )
                }

                MULTIMEDIA_STATE, SMART_TV_STATE -> {
                    leftClickDetector.cancel()
                    mediaDetector.cancel()
                    requestTextMode(
                        tapIdentifier,
                        "native profile $stateName"
                    )
                    log(
                        "[Mode] Native $stateName profile active; " +
                            "custom gesture injection suspended"
                    )
                }

                else -> {
                    if (decoderActive()) {
                        requestControllerWithMouseHidMode(
                            tapIdentifier,
                            "$stateName while decoder active"
                        )
                        log(
                            "[Mode] $stateName state — Tap Code/trainer controller " +
                                "mode retained/restored"
                        )
                    } else {
                        requestTextMode(tapIdentifier, stateName)
                        log("[Mode] $stateName state — stock keyboard retained")
                    }
                }
            }
        }

        override fun onError(
            tapIdentifier: String,
            code: Int,
            description: String
        ) {
            log("Tap error $code ($tapIdentifier): $description")
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        tapCodeEnabledState = CompanionSettings.tapCodeEnabled(applicationContext)
        createNotificationChannel()
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle("TapLab Companion")
                .setContentText("Tap AirMouse override active")
                .setOngoing(true)
                .build()
        )

        injectorThread = HandlerThread("TapLabRootInjector").apply { start() }
        injectorHandler = Handler(injectorThread.looper)
        RootInjector.logSink = ::log
        injectorHandler.post {
            val eventDevice = RootInjector.discoverTapEventDevice()
            log(
                eventDevice?.let { "Tap event node: $it" }
                    ?: "Tap event node not found"
            )
            log("Root status: ${RootInjector.testRoot()}")
        }

        sdk = TapSdkFactory.getDefault(applicationContext)
        sdk.setDefaultMode(TapInputMode.text(), true)
        sdk.registerTapListener(tapListener)
        sdk.resume()

        if (decoderActive()) {
            injectorHandler.post {
                if (isTapCodeEnabled()) {
                    applyTapCodeEnabled(true, force = true)
                } else {
                    sdk.getConnectedTaps().forEach { tapIdentifier ->
                        requestControllerWithMouseHidMode(
                            tapIdentifier,
                            "native trainer active at service start"
                        )
                    }
                    startDecoderTickIfNeeded()
                }
            }
        }
        log("Override service started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_ENABLE_TAPCODE -> {
                injectorHandler.post { applyTapCodeEnabled(true) }
            }

            ACTION_DISABLE_TAPCODE -> {
                injectorHandler.post { applyTapCodeEnabled(false) }
            }

            ACTION_TOGGLE_TAPCODE -> {
                injectorHandler.post { applyTapCodeEnabled(!isTapCodeEnabled()) }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        trainingSink?.let { sink ->
            runCatching {
                sink(TapCodeEvent.Error("Override service stopped"))
            }
        }
        trainingSink = null
        tapCodeEnabledState = false
        instance = null

        if (::injectorHandler.isInitialized) {
            injectorHandler.removeCallbacks(tapCodeTick)
            tapCodeDecoder.reset()
            leftClickDetector.cancel()
            mediaDetector.cancel()
        }

        if (::sdk.isInitialized) {
            sdk.getConnectedTaps().forEach { tapIdentifier ->
                requestTextMode(tapIdentifier, "service shutdown")
            }
            sdk.unregisterTapListener(tapListener)
            sdk.pause()
        }

        RootInjector.logSink = null

        if (::injectorThread.isInitialized) {
            injectorThread.quitSafely()
        }

        log("Override service stopped; text mode restored")
        super.onDestroy()
    }

    private fun applyTapCodeEnabled(enabled: Boolean, force: Boolean = false) {
        if (!force && tapCodeEnabledState == enabled) return

        tapCodeEnabledState = enabled
        CompanionSettings.setTapCodeEnabled(applicationContext, enabled)
        tapCodeDecoder.reset()
        injectorHandler.removeCallbacks(tapCodeTick)

        sdk.getConnectedTaps().forEach { tapIdentifier ->
            if (enabled || isTraining()) {
                requestControllerWithMouseHidMode(
                    tapIdentifier,
                    if (enabled) "Tap Code enabled" else "native trainer active"
                )
            } else {
                requestTextMode(tapIdentifier, "Tap Code disabled")
            }
        }

        if (decoderActive()) {
            startDecoderTickIfNeeded()
        }

        if (enabled) {
            log("Tap Code typing ON — controller mode active")
        } else if (isTraining()) {
            log("Tap Code typing OFF — native trainer retains controller mode")
        } else {
            log("Tap Code typing OFF — stock keyboard restored")
        }
    }

    private fun handleTapCodeEvent(event: TapCodeEvent) {
        val trainer = trainingSink

        when (event) {
            is TapCodeEvent.Commit -> {
                val display = event.text
                    .replace(" ", "<SPACE>")
                    .replace("\n", "<ENTER>")
                    .replace("\r", "<CR>")
                log("Tap Code commit: $display")
                if (trainer == null) {
                    if (event.text.length == 1) {
                        RootInjector.typeChar(event.text[0])
                    } else {
                        RootInjector.typeText(event.text)
                    }
                }
            }

            is TapCodeEvent.Action -> {
                when (event.action) {
                    TapAction.BACKSPACE -> {
                        log("Tap Code action: BACKSPACE")
                        if (trainer == null) RootInjector.keyBackspace()
                    }

                    TapAction.ENTER -> {
                        log("Tap Code action: ENTER")
                        if (trainer == null) RootInjector.keyEnter()
                    }
                }
            }

            TapCodeEvent.Cancel -> {
                log("Tap Code sequence canceled")
                sendErrorHaptic()
            }

            is TapCodeEvent.Error -> {
                log("Tap Code error: ${event.reason}")
                sendErrorHaptic()
            }

            TapCodeEvent.ModeToggle -> {
                log("Tap Code mode toggle requested")
                if (trainer == null) {
                    applyTapCodeEnabled(!isTapCodeEnabled())
                }
            }

            is TapCodeEvent.Pending -> {
                log("Tap Code pending: ${event.display.ifEmpty { "<CLEARED>" }}")
            }
        }

        if (trainer != null) {
            runCatching { trainer(event) }
                .onFailure {
                    log(
                        "[Trainer] Event callback failed: " +
                            (it.message ?: it.javaClass.simpleName)
                    )
                }
        }
    }

    private fun decoderActive(): Boolean {
        return isTapCodeEnabled() || isTraining()
    }

    private fun startDecoderTickIfNeeded() {
        injectorHandler.removeCallbacks(tapCodeTick)
        if (decoderActive()) {
            injectorHandler.post(tapCodeTick)
        }
    }

    private fun sendErrorHaptic() {
        val tapIdentifier = lastTapIdentifier ?: return
        val pattern = intArrayOf(60, 40, 60)

        val sent = runCatching {
            val method = sdk.javaClass.methods.firstOrNull {
                it.name in setOf("vibrate", "sendHapticPacket") &&
                    it.parameterTypes.size == 2 &&
                    it.parameterTypes[0].isAssignableFrom(String::class.java)
            } ?: return@runCatching false

            val payload = when (method.parameterTypes[1]) {
                IntArray::class.java -> pattern
                ByteArray::class.java -> pattern.map(Int::toByte).toByteArray()
                else -> return@runCatching false
            }
            method.invoke(sdk, tapIdentifier, payload)
            true
        }.getOrDefault(false)

        if (!sent) {
            log("Tap Code error haptic unavailable")
        }
    }

    private fun requestTextMode(tapIdentifier: String, reason: String) {
        log(
            "[Mode] SDK mode requested: device=${shortDeviceId(tapIdentifier)} " +
                "mode=TEXT reason=$reason"
        )
        sdk.startTextMode(tapIdentifier)
        log(
            "[Regular] Stock HID keyboard active; individual keys are handled " +
                "by Android and are not observable through Tap SDK"
        )
    }

    private fun requestControllerWithMouseHidMode(
        tapIdentifier: String,
        reason: String
    ) {
        log(
            "[Mode] SDK mode requested: device=${shortDeviceId(tapIdentifier)} " +
                "mode=CONTROLLER_WITH_MOUSE_HID reason=$reason"
        )
        sdk.startControllerWithMouseHIDMode(tapIdentifier)
    }

    @Synchronized
    private fun logAirMouseMotionSummary() {
        val count = airMouseMotionPacketCount
        airMouseMotionPacketCount = 0
        if (count > 0) {
            log("AirMouse cursor-motion summary: suppressed=$count packets")
        }
    }

    @Synchronized
    private fun logRawSensorPacket(
        tapIdentifier: String,
        rsData: RawSensorData
    ) {
        val nowMs = System.currentTimeMillis()
        if (nowMs - lastRawSensorLogMs < RAW_SENSOR_LOG_INTERVAL_MS) {
            suppressedRawSensorPackets += 1
            return
        }

        val suppressed = suppressedRawSensorPackets
        suppressedRawSensorPackets = 0
        lastRawSensorLogMs = nowMs
        log(
            "Raw sensor input: device=${shortDeviceId(tapIdentifier)} " +
                "data=$rsData suppressed=$suppressed"
        )
    }

    private fun tapStateName(state: Int): String {
        return when (state) {
            KEYBOARD_STATE -> "KEYBOARD"
            AIR_MOUSE_STATE -> "AIRMOUSE"
            MULTIMEDIA_STATE -> "MULTIMEDIA"
            SMART_TV_STATE -> "SMART_TV"
            else -> "UNKNOWN($state)"
        }
    }

    private fun gestureName(gesture: Int): String {
        return when (gesture) {
            AirMousePacket.AIR_MOUSE_GESTURE_NONE -> "NONE"
            AirMousePacket.AIR_MOUSE_GESTURE_GENERAL -> "GENERAL"
            AirMousePacket.AIR_MOUSE_GESTURE_UP -> "ONE_FINGER_UP"
            AirMousePacket.AIR_MOUSE_GESTURE_UP_TWO_FINGERS -> "TWO_FINGERS_UP"
            AirMousePacket.AIR_MOUSE_GESTURE_DOWN -> "ONE_FINGER_DOWN"
            AirMousePacket.AIR_MOUSE_GESTURE_DOWN_TWO_FINGERS -> "TWO_FINGERS_DOWN"
            AirMousePacket.AIR_MOUSE_GESTURE_LEFT -> "ONE_FINGER_LEFT"
            AirMousePacket.AIR_MOUSE_GESTURE_LEFT_TWO_FINGERS -> "TWO_FINGERS_LEFT"
            AirMousePacket.AIR_MOUSE_GESTURE_RIGHT -> "ONE_FINGER_RIGHT"
            AirMousePacket.AIR_MOUSE_GESTURE_RIGHT_TWO_FINGERS -> "TWO_FINGERS_RIGHT"
            AirMousePacket.AIR_MOUSE_GESTURE_INDEX_TO_THUMB_TOUCH -> "INDEX_TO_THUMB_TOUCH"
            AirMousePacket.AIR_MOUSE_GESTURE_MIDDLE_TO_THUMB_TOUCH -> "MIDDLE_TO_THUMB_TOUCH"
            AirMousePacket.XR_AIR_GESTURE_NONE -> "XR_NONE"
            AirMousePacket.XR_AIR_GESTURE_THUMB_INDEX -> "XR_THUMB_INDEX"
            AirMousePacket.XR_AIR_GESTURE_THUMB_MIDDLE -> "XR_THUMB_MIDDLE"
            else -> "UNKNOWN"
        }
    }

    private fun fingerNames(code: Int): String {
        val names = buildList {
            if (code and TapCodeDecoder.THUMB != 0) add("Thumb")
            if (code and TapCodeDecoder.INDEX != 0) add("Index")
            if (code and TapCodeDecoder.MIDDLE != 0) add("Middle")
            if (code and TapCodeDecoder.RING != 0) add("Ring")
            if (code and TapCodeDecoder.PINKY != 0) add("Pinky")
        }
        return names.joinToString("+").ifEmpty { "None" }
    }

    private fun fiveBitBinary(code: Int): String {
        return Integer.toBinaryString(code and TAP_CODE_BIT_MASK).padStart(5, '0')
    }

    private fun bytesHex(vararg values: Int): String {
        return values.joinToString(" ") { value ->
            "%02X".format(value and 0xff)
        }
    }

    private fun shortDeviceId(tapIdentifier: String): String {
        if (tapIdentifier.length <= SHORT_DEVICE_ID_LENGTH) return tapIdentifier
        return "…${tapIdentifier.takeLast(SHORT_DEVICE_ID_LENGTH)}"
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Tap AirMouse override",
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun log(message: String) {
        Log.i(TAG, message)
        val formatted = DiagnosticLog.append(applicationContext, message)
        logSink?.invoke(formatted)
    }

    private inner class DoubleTapDetector(
        private val name: String,
        private val singleAction: () -> Unit,
        private val doubleAction: () -> Unit
    ) {
        private var pendingSingle: Runnable? = null

        fun onEvent() {
            injectorHandler.post {
                val pending = pendingSingle
                if (pending != null) {
                    log("Double-tap detector [$name]: second event detected")
                    injectorHandler.removeCallbacks(pending)
                    pendingSingle = null
                    log("Double-tap detector [$name]: DOUBLE action fired")
                    doubleAction()
                } else {
                    val windowMs = CompanionSettings.doubleTapWindowMs(
                        applicationContext
                    )
                    log(
                        "Double-tap detector [$name]: first event pending " +
                            "for ${windowMs}ms"
                    )
                    val action = Runnable {
                        pendingSingle = null
                        log("Double-tap detector [$name]: SINGLE action fired")
                        singleAction()
                    }
                    pendingSingle = action
                    injectorHandler.postDelayed(action, windowMs)
                }
            }
        }

        fun cancel() {
            pendingSingle?.let(injectorHandler::removeCallbacks)
            pendingSingle = null
        }
    }

    companion object {
        const val ACTION_ENABLE_TAPCODE =
            "com.maasailabs.taplab.companion.action.ENABLE_TAPCODE"
        const val ACTION_DISABLE_TAPCODE =
            "com.maasailabs.taplab.companion.action.DISABLE_TAPCODE"
        const val ACTION_TOGGLE_TAPCODE =
            "com.maasailabs.taplab.companion.action.TOGGLE_TAPCODE"

        @Volatile
        var logSink: ((String) -> Unit)? = null

        @Volatile
        private var tapCodeEnabledState = false

        @Volatile
        private var instance: TapOverrideService? = null

        @Volatile
        private var trainingSink: ((TapCodeEvent) -> Unit)? = null

        fun isRunning(): Boolean = instance != null

        fun isTapCodeEnabled(): Boolean = tapCodeEnabledState

        fun isTraining(): Boolean = trainingSink != null

        fun beginTraining(sink: (TapCodeEvent) -> Unit) {
            trainingSink = sink
            val activeService = instance ?: return
            activeService.injectorHandler.post {
                activeService.tapCodeDecoder.reset()
                activeService.sdk.getConnectedTaps().forEach { tapIdentifier ->
                    activeService.requestControllerWithMouseHidMode(
                        tapIdentifier,
                        "native trainer started"
                    )
                }
                activeService.startDecoderTickIfNeeded()
                activeService.log(
                    "[Trainer] Native training started; " +
                        "system text injection suspended"
                )
            }
        }

        fun endTraining() {
            if (trainingSink == null) return
            trainingSink = null
            val activeService = instance ?: return
            activeService.injectorHandler.post {
                activeService.tapCodeDecoder.reset()
                activeService.sdk.getConnectedTaps().forEach { tapIdentifier ->
                    if (isTapCodeEnabled()) {
                        activeService.requestControllerWithMouseHidMode(
                            tapIdentifier,
                            "native trainer ended; Tap Code remains enabled"
                        )
                    } else {
                        activeService.requestTextMode(
                            tapIdentifier,
                            "native trainer ended"
                        )
                    }
                }
                if (activeService.decoderActive()) {
                    activeService.startDecoderTickIfNeeded()
                } else {
                    activeService.injectorHandler.removeCallbacks(
                        activeService.tapCodeTick
                    )
                }
                activeService.log(
                    "[Trainer] Native training stopped; previous Tap mode restored"
                )
            }
        }

        fun setTapCodeEnabled(enabled: Boolean) {
            val activeService = instance
            if (activeService == null) {
                tapCodeEnabledState = enabled
                return
            }

            activeService.injectorHandler.post {
                activeService.applyTapCodeEnabled(enabled)
            }
        }

        fun onSettingsChanged() {
            val activeService = instance ?: return
            activeService.injectorHandler.post {
                activeService.leftClickDetector.cancel()
                activeService.mediaDetector.cancel()
                activeService.log(
                    "Companion settings reloaded live; " +
                        "pending double-tap actions canceled"
                )
            }
        }

        private const val TAG = "TapLabCompanion"
        private const val NOTIFICATION_CHANNEL_ID = "taplab_override"
        private const val NOTIFICATION_ID = 1
        private const val KEYBOARD_STATE = 0
        private const val AIR_MOUSE_STATE = 1
        private const val MULTIMEDIA_STATE = 2
        private const val SMART_TV_STATE = 3
        private const val TAP_CODE_TICK_MS = 100L
        private const val RAW_SENSOR_LOG_INTERVAL_MS = 1_000L
        private const val TAP_CODE_BIT_MASK = 0x1f
        private const val THUMB_INDEX_CHORD = 3
        private const val THUMB_MIDDLE_CHORD = 5
        private const val SHORT_DEVICE_ID_LENGTH = 8
        private const val MEDIA_PLAY_PAUSE_KEYCODE = 85
        private const val BACK_KEYCODE = 4
    }
}
