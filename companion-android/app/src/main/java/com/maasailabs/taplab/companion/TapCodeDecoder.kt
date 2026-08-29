package com.maasailabs.taplab.companion

enum class TapAction {
    BACKSPACE,
    ENTER
}

sealed class TapCodeEvent {
    data class Commit(val text: String) : TapCodeEvent()
    data class Action(val action: TapAction) : TapCodeEvent()
    object Cancel : TapCodeEvent()
    data class Error(val reason: String) : TapCodeEvent()
    object ModeToggle : TapCodeEvent()
    data class Pending(val display: String) : TapCodeEvent()
}

/**
 * Framework-free stateful decoder for the Thumb-Free Tap Code.
 *
 * Timeouts only recover from incomplete input and never produce text.
 */
class TapCodeDecoder(
    private val timeoutMs: Long = 800L,
    private val onEvent: (TapCodeEvent) -> Unit
) {
    private var pendingSymbol: Int? = null
    private var controlRow = false
    private var pendingSinceMs = 0L

    init {
        require(timeoutMs > 0L) { "Tap Code timeout must be positive" }
    }

    fun feed(code: Int, nowMs: Long) {
        when {
            code == IM_CONTROL -> handleImControl()
            code == MR_CONTROL -> handleMrControl(nowMs)
            SYMBOL_INDEX.containsKey(code) -> handleLetterSymbol(code, nowMs)
            else -> {
                clearPending()
                onEvent(TapCodeEvent.Error("Invalid Tap Code chord: $code"))
            }
        }
    }

    fun tick(nowMs: Long) {
        if (
            (pendingSymbol != null || controlRow) &&
            nowMs - pendingSinceMs >= timeoutMs
        ) {
            clearPending()
            onEvent(TapCodeEvent.Error("timeout"))
        }
    }

    fun reset() {
        clearPending()
    }

    private fun handleImControl() {
        if (pendingSymbol == null && !controlRow) {
            onEvent(TapCodeEvent.Commit(" "))
            return
        }

        clearPending()
        onEvent(TapCodeEvent.Cancel)
    }

    private fun handleMrControl(nowMs: Long) {
        if (pendingSymbol != null) {
            clearPending()
            onEvent(TapCodeEvent.Error("MR cannot follow a letter-row symbol"))
            return
        }

        if (controlRow) {
            clearPending()
            onEvent(TapCodeEvent.ModeToggle)
            return
        }

        controlRow = true
        pendingSinceMs = nowMs
        onEvent(TapCodeEvent.Pending("MR+"))
    }

    private fun handleLetterSymbol(symbol: Int, nowMs: Long) {
        if (controlRow) {
            clearPending()
            commitControlSymbol(symbol)
            return
        }

        val firstSymbol = pendingSymbol
        if (firstSymbol == null) {
            pendingSymbol = symbol
            pendingSinceMs = nowMs
            onEvent(TapCodeEvent.Pending("${SYMBOL_NAMES.getValue(symbol)}·"))
            return
        }

        val row = SYMBOL_INDEX.getValue(firstSymbol)
        val column = SYMBOL_INDEX.getValue(symbol)
        val text = GRID[row][column].toString()

        clearPending()
        onEvent(TapCodeEvent.Commit(text))
    }

    private fun commitControlSymbol(symbol: Int) {
        when (symbol) {
            INDEX -> onEvent(TapCodeEvent.Commit("z"))
            MIDDLE -> onEvent(TapCodeEvent.Action(TapAction.BACKSPACE))
            RING -> onEvent(TapCodeEvent.Action(TapAction.ENTER))
            PINKY -> onEvent(TapCodeEvent.Commit("."))
            RING_PINKY -> onEvent(TapCodeEvent.Commit(","))
        }
    }

    private fun clearPending() {
        pendingSymbol = null
        controlRow = false
        pendingSinceMs = 0L
    }

    companion object {
        const val THUMB = 1
        const val INDEX = 2
        const val MIDDLE = 4
        const val RING = 8
        const val PINKY = 16
        const val RING_PINKY = 24
        const val IM_CONTROL = 6
        const val MR_CONTROL = 12

        val SYMBOLS = intArrayOf(INDEX, MIDDLE, RING, PINKY, RING_PINKY)

        val SYMBOL_NAMES: Map<Int, String> = mapOf(
            INDEX to "Index",
            MIDDLE to "Middle",
            RING to "Ring",
            PINKY to "Pinky",
            RING_PINKY to "Ring+Pinky"
        )

        val GRID: Array<CharArray> = arrayOf(
            charArrayOf('a', 'b', 'c', 'd', 'e'),
            charArrayOf('f', 'g', 'h', 'i', 'j'),
            charArrayOf('k', 'l', 'm', 'n', 'o'),
            charArrayOf('p', 'q', 'r', 's', 't'),
            charArrayOf('u', 'v', 'w', 'x', 'y')
        )

        private val SYMBOL_INDEX = SYMBOLS
            .withIndex()
            .associate { (index, symbol) -> symbol to index }

        fun sequenceFor(text: String): List<Int> {
            return buildList {
                text.forEach { character ->
                    when (character.lowercaseChar()) {
                        in 'a'..'y' -> {
                            val index = character.lowercaseChar() - 'a'
                            add(SYMBOLS[index / SYMBOLS.size])
                            add(SYMBOLS[index % SYMBOLS.size])
                        }

                        'z' -> {
                            add(MR_CONTROL)
                            add(INDEX)
                        }

                        ' ' -> add(IM_CONTROL)
                        '.' -> {
                            add(MR_CONTROL)
                            add(PINKY)
                        }

                        ',' -> {
                            add(MR_CONTROL)
                            add(RING_PINKY)
                        }

                        '\b' -> {
                            add(MR_CONTROL)
                            add(MIDDLE)
                        }

                        '\n', '\r' -> {
                            add(MR_CONTROL)
                            add(RING)
                        }

                        else -> throw IllegalArgumentException(
                            "Character cannot be represented in Tap Code: $character"
                        )
                    }
                }
            }
        }
    }
}
