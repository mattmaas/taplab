package com.maasailabs.taplab.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TapCodeDecoderTest {
    @Test
    fun `decodes the complete a through y grid`() {
        for (row in TapCodeDecoder.SYMBOLS.indices) {
            for (column in TapCodeDecoder.SYMBOLS.indices) {
                val events = mutableListOf<TapCodeEvent>()
                val decoder = TapCodeDecoder(onEvent = events::add)
                decoder.feed(TapCodeDecoder.SYMBOLS[row], 0)
                decoder.feed(TapCodeDecoder.SYMBOLS[column], 1)
                val expected = ('a'.code + row * 5 + column).toChar().toString()
                assertEquals(expected, events.filterIsInstance<TapCodeEvent.Commit>().single().text)
            }
        }
    }

    @Test
    fun `space commits immediately and IM cancels a pending pair`() {
        val events = mutableListOf<TapCodeEvent>()
        val decoder = TapCodeDecoder(onEvent = events::add)
        decoder.feed(TapCodeDecoder.IM_CONTROL, 0)
        assertEquals(" ", (events.last() as TapCodeEvent.Commit).text)

        decoder.feed(TapCodeDecoder.INDEX, 1)
        decoder.feed(TapCodeDecoder.IM_CONTROL, 2)
        assertTrue(events.last() === TapCodeEvent.Cancel)
    }

    @Test
    fun `control row emits z backspace enter period comma and mode toggle`() {
        val secondSymbols = listOf(
            TapCodeDecoder.INDEX,
            TapCodeDecoder.MIDDLE,
            TapCodeDecoder.RING,
            TapCodeDecoder.PINKY,
            TapCodeDecoder.RING_PINKY,
            TapCodeDecoder.MR_CONTROL
        )
        val expected = listOf(
            TapCodeEvent.Commit("z"),
            TapCodeEvent.Action(TapAction.BACKSPACE),
            TapCodeEvent.Action(TapAction.ENTER),
            TapCodeEvent.Commit("."),
            TapCodeEvent.Commit(","),
            TapCodeEvent.ModeToggle
        )

        secondSymbols.zip(expected).forEach { (second, wanted) ->
            val events = mutableListOf<TapCodeEvent>()
            val decoder = TapCodeDecoder(onEvent = events::add)
            decoder.feed(TapCodeDecoder.MR_CONTROL, 0)
            decoder.feed(second, 1)
            assertEquals(wanted, events.last())
        }
    }

    @Test
    fun `invalid chord clears state and resynchronizes`() {
        val events = mutableListOf<TapCodeEvent>()
        val decoder = TapCodeDecoder(onEvent = events::add)
        decoder.feed(TapCodeDecoder.INDEX, 0)
        decoder.feed(TapCodeDecoder.THUMB, 1)
        assertTrue(events.last() is TapCodeEvent.Error)

        decoder.feed(TapCodeDecoder.MIDDLE, 2)
        decoder.feed(TapCodeDecoder.MIDDLE, 3)
        assertEquals("g", (events.last() as TapCodeEvent.Commit).text)
    }

    @Test
    fun `timeout flushes without committing text`() {
        val events = mutableListOf<TapCodeEvent>()
        val decoder = TapCodeDecoder(timeoutMs = 800, onEvent = events::add)
        decoder.feed(TapCodeDecoder.RING, 100)
        decoder.tick(899)
        assertTrue(events.last() is TapCodeEvent.Pending)
        decoder.tick(900)
        assertEquals(TapCodeEvent.Error("timeout"), events.last())
        assertTrue(events.none { it is TapCodeEvent.Commit })
    }

    @Test
    fun `sequenceFor represents hello world`() {
        val output = StringBuilder()
        val decoder = TapCodeDecoder(onEvent = { event ->
            if (event is TapCodeEvent.Commit) output.append(event.text)
        })
        TapCodeDecoder.sequenceFor("hello world").forEachIndexed { index, code ->
            decoder.feed(code, index.toLong())
        }
        assertEquals("hello world", output.toString())
    }
}
