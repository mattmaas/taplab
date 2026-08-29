package com.maasailabs.taplab.companion

import android.util.Log
import java.io.DataOutputStream

object RootInjector {
    private const val TAG = "TapLabRootInjector"
    private val shellLock = Any()

    @Volatile
    var logSink: ((String) -> Unit)? = null

    private var shellProcess: Process? = null
    private var shellInput: DataOutputStream? = null
    private var tapEventDevice: String? = null

    fun sh(cmd: String) {
        debug("SHELL action requested")
        queueShellCommand(cmd, "shell command")
    }

    fun testRoot(): String {
        return try {
            val process = ProcessBuilder("su", "-c", "id")
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().use { it.readText().trim() }
            val exitCode = process.waitFor()
            if (exitCode == 0) {
                output.ifBlank { "Root granted (no output)" }
            } else {
                "Root unavailable (exit $exitCode): ${output.ifBlank { "no output" }}"
            }
        } catch (error: Exception) {
            "Root test failed: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    fun discoverTapEventDevice(): String? {
        debug("Event-node discovery started")
        val devices = try {
            val process = ProcessBuilder(
                "su",
                "-c",
                "cat /proc/bus/input/devices"
            ).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            val exitCode = process.waitFor()
            if (exitCode != 0) {
                debug(
                    "Event-node discovery failed: exit=$exitCode " +
                        "output=${output.trim().take(200)}"
                )
                return null
            }
            output
        } catch (error: Exception) {
            debug(
                "Event-node discovery failed: " +
                    "${error.message ?: error.javaClass.simpleName}"
            )
            return null
        }

        val blocks = devices.split(Regex("""\r?\n\s*\r?\n"""))
        // Android's Bluetooth HID driver often exposes a device named
        // "Tap_<id> Mouse" whose Handlers line contains only eventN — no
        // literal mouse token. Prefer the descriptive device name, while
        // retaining the handler check for kernels that do expose mouseN.
        val tapBlock = blocks.firstOrNull { block ->
            nameContainsTap(block) &&
                (deviceName(block).contains("mouse", ignoreCase = true) ||
                    hasMouseHandler(block))
        }
        val fallbackBlock = blocks.firstOrNull { block ->
            val isBluetooth = Regex(
                """(?im)^I:\s+Bus=0005\b"""
            ).containsMatchIn(block)
            isBluetooth &&
                (deviceName(block).contains("mouse", ignoreCase = true) ||
                    hasMouseHandler(block))
        }
        val selectedBlock = tapBlock ?: fallbackBlock
        val eventHandler = selectedBlock?.let {
            Regex("""(?m)^H:\s+Handlers=.*\b(event\d+)\b""")
                .find(it)
                ?.groupValues
                ?.get(1)
        }

        tapEventDevice = eventHandler?.let { "/dev/input/$it" }
        if (tapEventDevice != null) {
            val matchType = if (tapBlock != null) "Tap mouse" else "BLE mouse fallback"
            debug(
                "Event-node selected: type=$matchType " +
                    "name=\"${selectedBlock?.let(::deviceName).orEmpty()}\" " +
                    "path=$tapEventDevice"
            )
        } else {
            val deviceNames = blocks
                .map(::deviceName)
                .filter(String::isNotBlank)
                .distinct()
            debug(
                "No matching mouse node; input devices present: " +
                    deviceNames.joinToString(prefix = "[", postfix = "]")
            )
        }
        return tapEventDevice
    }

    fun clickLeft() {
        debug("ACTION requested: clickLeft")
        click(272, "LEFT click")
    }

    fun clickRight() {
        debug("ACTION requested: clickRight")
        click(273, "RIGHT click")
    }

    fun scroll(direction: Int) {
        val directionName = if (direction >= 0) "UP" else "DOWN"
        debug("ACTION requested: scroll direction=$directionName raw=$direction")
        val device = requireTapEventDevice("scroll $directionName") ?: return
        val value = if (direction >= 0) 1 else -1
        queueShellCommand(
            "sendevent $device 2 8 $value && sendevent $device 0 0 0",
            "scroll $directionName to $device"
        )
    }

    fun keyevent(code: Int) {
        val name = keyeventName(code)
        debug("ACTION requested: keyevent code=$code name=$name")
        // Android's input command is slow (~300 ms), which is acceptable for media/back.
        queueShellCommand("input keyevent $code", "keyevent $code ($name)")
    }

    fun typeText(text: String) {
        if (text.isEmpty()) {
            debug("ACTION skipped: typeText was empty")
            return
        }

        val display = readableText(text).take(MAX_DEBUG_TEXT_LENGTH)
        val suffix = if (readableText(text).length > MAX_DEBUG_TEXT_LENGTH) "…" else ""
        debug("ACTION requested: typeText \"$display$suffix\" length=${text.length}")
        // Android's input text command takes ~200-300 ms, acceptable at Tap Code speeds.
        queueShellCommand(
            "input text ${quoteInputText(text)}",
            "Tap Code text \"$display$suffix\""
        )
    }

    fun typeChar(c: Char) {
        val display = readableCharacter(c)
        debug("ACTION requested: typeChar '$display'")
        // Avoid creating an intermediate one-character String before escaping.
        queueShellCommand(
            "input text ${quoteInputText(c)}",
            "Tap Code character '$display'"
        )
    }

    fun keyBackspace() = keyevent(67)

    fun keyEnter() = keyevent(66)

    private fun click(buttonCode: Int, description: String) {
        val device = requireTapEventDevice(description) ?: return
        queueShellCommand(
            "sendevent $device 1 $buttonCode 1" +
                " && sendevent $device 0 0 0" +
                " && sendevent $device 1 $buttonCode 0" +
                " && sendevent $device 0 0 0",
            "$description to $device"
        )
    }

    private fun requireTapEventDevice(action: String): String? {
        val device = tapEventDevice ?: discoverTapEventDevice()
        if (device == null) {
            debug("INJECT dropped: $action; no matching mouse event node")
        }
        return device
    }

    private fun nameContainsTap(block: String): Boolean {
        return deviceName(block).contains("tap", ignoreCase = true)
    }

    private fun deviceName(block: String): String {
        return Regex("""(?im)^N:\s+Name="([^"]+)"""")
            .find(block)
            ?.groupValues
            ?.get(1)
            .orEmpty()
    }

    private fun hasMouseHandler(block: String): Boolean {
        return Regex("""(?im)^H:\s+Handlers=.*\bmouse\d*\b""").containsMatchIn(block)
    }

    private fun quoteInputText(text: String): String {
        val escaped = StringBuilder(text.length + 2)
        escaped.append('"')
        text.forEach { appendEscapedInputCharacter(escaped, it) }
        escaped.append('"')
        return escaped.toString()
    }

    private fun quoteInputText(character: Char): String {
        val escaped = StringBuilder(4)
        escaped.append('"')
        appendEscapedInputCharacter(escaped, character)
        escaped.append('"')
        return escaped.toString()
    }

    private fun appendEscapedInputCharacter(output: StringBuilder, character: Char) {
        when (character) {
            ' ' -> output.append("%s")
            '\\' -> output.append("\\\\")
            '"' -> output.append("\\\"")
            '`' -> output.append("\\`")
            '$' -> output.append("\\$")
            '\n', '\r' -> output.append("%s")
            else -> output.append(character)
        }
    }

    private fun queueShellCommand(command: String, safeSummary: String) {
        synchronized(shellLock) {
            ensureShell()
            try {
                shellInput!!.writeBytes("$command\n")
                shellInput!!.flush()
                debug("INJECT queued: $safeSummary")
            } catch (firstError: Exception) {
                debug(
                    "Persistent root shell write failed for $safeSummary; " +
                        "recreating shell: " +
                        "${firstError.message ?: firstError.javaClass.simpleName}"
                )
                closeShell()
                try {
                    ensureShell()
                    shellInput!!.writeBytes("$command\n")
                    shellInput!!.flush()
                    debug("INJECT queued after shell recreation: $safeSummary")
                } catch (retryError: Exception) {
                    debug(
                        "INJECT failed: $safeSummary; " +
                            "${retryError.message ?: retryError.javaClass.simpleName}"
                    )
                    throw retryError
                }
            }
        }
    }

    private fun ensureShell() {
        if (shellProcess?.isAlive == true && shellInput != null) {
            return
        }

        closeShell()
        debug("Creating persistent root shell")
        try {
            val process = Runtime.getRuntime().exec("su")
            shellProcess = process
            shellInput = DataOutputStream(process.outputStream)
            debug("Persistent root shell created")
        } catch (error: Exception) {
            debug(
                "Persistent root shell creation failed: " +
                    "${error.message ?: error.javaClass.simpleName}"
            )
            throw error
        }
    }

    private fun closeShell() {
        val hadShell = shellProcess != null || shellInput != null
        runCatching { shellInput?.close() }
        runCatching { shellProcess?.destroy() }
        shellInput = null
        shellProcess = null
        if (hadShell) {
            debug("Persistent root shell closed")
        }
    }

    private fun keyeventName(code: Int): String {
        return when (code) {
            4 -> "BACK"
            66 -> "ENTER"
            67 -> "BACKSPACE"
            85 -> "MEDIA_PLAY_PAUSE"
            else -> "UNKNOWN"
        }
    }

    private fun readableText(text: String): String {
        return buildString {
            text.forEach { append(readableCharacter(it)) }
        }
    }

    private fun readableCharacter(character: Char): String {
        return when (character) {
            ' ' -> "<SPACE>"
            '\n' -> "<ENTER>"
            '\r' -> "<CR>"
            '\t' -> "<TAB>"
            else -> if (character.isISOControl()) {
                "\\u%04X".format(character.code)
            } else {
                character.toString()
            }
        }
    }

    private fun debug(message: String) {
        Log.i(TAG, message)
        logSink?.invoke(message)
    }

    private const val MAX_DEBUG_TEXT_LENGTH = 40
}
