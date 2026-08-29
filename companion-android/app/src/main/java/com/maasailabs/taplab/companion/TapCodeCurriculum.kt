package com.maasailabs.taplab.companion

import kotlin.random.Random

enum class TapCodeLessonKind {
    CHARACTER,
    WORD,
    SENTENCE
}

data class TapCodeLesson(
    val id: Int,
    val name: String,
    val description: String,
    val prompts: List<String>,
    val kind: TapCodeLessonKind
)

object TapCodeCurriculum {
    val LESSONS: List<TapCodeLesson> = listOf(
        TapCodeLesson(
            id = 1,
            name = "Diagonal doubles",
            description = "Learn the five same-symbol diagonal letters.",
            prompts = listOf("a", "g", "m", "s", "y"),
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 2,
            name = "Row 1 + space",
            description = "Practice a-e and the IM space chord.",
            prompts = ('a'..'e').map(Char::toString) + " ",
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 3,
            name = "Rows 1-2",
            description = "Practice a-j and space.",
            prompts = ('a'..'j').map(Char::toString) + " ",
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 4,
            name = "Rows 1-3",
            description = "Practice a-o and space.",
            prompts = ('a'..'o').map(Char::toString) + " ",
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 5,
            name = "Rows 1-4",
            description = "Practice a-t and space.",
            prompts = ('a'..'t').map(Char::toString) + " ",
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 6,
            name = "Full grid",
            description = "Practice every grid letter a-y and space.",
            prompts = ('a'..'y').map(Char::toString) + " ",
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 7,
            name = "Control plane",
            description = "Practice z, editing controls, and punctuation.",
            prompts = listOf("z", "\b", "\n", ".", ","),
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 8,
            name = "Everything",
            description = "Practice every supported character and control.",
            prompts = ('a'..'z').map(Char::toString) +
                listOf(" ", ".", ",", "\b", "\n"),
            kind = TapCodeLessonKind.CHARACTER
        ),
        TapCodeLesson(
            id = 9,
            name = "Common words",
            description = "Build fluency with frequently used lowercase words.",
            prompts = listOf(
                "the",
                "and",
                "you",
                "that",
                "was",
                "for",
                "with",
                "have",
                "this",
                "from"
            ),
            kind = TapCodeLessonKind.WORD
        ),
        TapCodeLesson(
            id = 10,
            name = "Sentences",
            description = "Practice short lowercase phrases with punctuation.",
            prompts = listOf(
                "the quick brown fox.",
                "practice makes progress.",
                "accuracy comes first.",
                "slow is smooth, smooth is fast.",
                "focus on each tap."
            ),
            kind = TapCodeLessonKind.SENTENCE
        )
    )

    fun displayPrompt(prompt: String): String {
        return buildString {
            prompt.forEach { character ->
                append(
                    when (character) {
                        ' ' -> "<SPACE>"
                        '\b' -> "<BACKSPACE>"
                        '\n', '\r' -> "<ENTER>"
                        else -> character.toString()
                    }
                )
            }
        }
    }

    fun hintFor(prompt: String): String {
        return prompt.map { character ->
            TapCodeDecoder.sequenceFor(character.toString())
                .joinToString(" · ") { code -> compactSymbolName(code) }
        }.joinToString("  |  ")
    }

    fun randomizedPrompts(
        lesson: TapCodeLesson,
        count: Int,
        weakChars: Set<Char> = emptySet()
    ): List<String> {
        val promptCount = count.coerceIn(1, 100)
        require(lesson.prompts.isNotEmpty()) { "Lesson must contain prompts" }

        val pool = if (lesson.kind == TapCodeLessonKind.CHARACTER) {
            buildList {
                lesson.prompts.forEach { prompt ->
                    add(prompt)
                    if (prompt.singleOrNull() in weakChars) {
                        repeat(2) { add(prompt) }
                    }
                }
            }
        } else {
            lesson.prompts
        }

        return List(promptCount) { pool[Random.nextInt(pool.size)] }
    }

    private fun compactSymbolName(code: Int): String {
        return when (code) {
            TapCodeDecoder.INDEX -> "I"
            TapCodeDecoder.MIDDLE -> "M"
            TapCodeDecoder.RING -> "R"
            TapCodeDecoder.PINKY -> "P"
            TapCodeDecoder.RING_PINKY -> "RP"
            TapCodeDecoder.IM_CONTROL -> "IM"
            TapCodeDecoder.MR_CONTROL -> "MR"
            else -> code.toString()
        }
    }
}
