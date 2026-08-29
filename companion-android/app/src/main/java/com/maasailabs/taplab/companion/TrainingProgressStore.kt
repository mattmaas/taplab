package com.maasailabs.taplab.companion

import android.content.Context

data class CharacterProgress(
    val char: Char,
    val attempts: Int,
    val correct: Int
) {
    val accuracy: Double
        get() = if (attempts == 0) 0.0 else correct.toDouble() / attempts
}

object TrainingProgressStore {
    @Synchronized
    fun record(context: Context, char: Char, correct: Boolean) {
        val preferences = preferences(context)
        val code = char.code
        val attemptsKey = attemptsKey(code)
        val correctKey = correctKey(code)
        preferences.edit()
            .putInt(attemptsKey, preferences.getInt(attemptsKey, 0) + 1)
            .putInt(
                correctKey,
                preferences.getInt(correctKey, 0) + if (correct) 1 else 0
            )
            .apply()
    }

    @Synchronized
    fun getAll(context: Context): List<CharacterProgress> {
        val preferences = preferences(context)
        return preferences.all.keys
            .asSequence()
            .filter { it.startsWith(ATTEMPTS_PREFIX) }
            .mapNotNull { key ->
                val code = key.removePrefix(ATTEMPTS_PREFIX).toIntOrNull()
                    ?: return@mapNotNull null
                val attempts = preferences.getInt(key, 0)
                if (attempts <= 0 || code !in Char.MIN_VALUE.code..Char.MAX_VALUE.code) {
                    return@mapNotNull null
                }
                CharacterProgress(
                    char = code.toChar(),
                    attempts = attempts,
                    correct = preferences.getInt(correctKey(code), 0)
                )
            }
            .sortedWith(
                compareBy<CharacterProgress> { it.accuracy }
                    .thenByDescending { it.attempts }
                    .thenBy { it.char.code }
            )
            .toList()
    }

    @Synchronized
    fun weakChars(
        context: Context,
        threshold: Double = 0.85,
        minAttempts: Int = 3
    ): Set<Char> {
        require(threshold in 0.0..1.0) { "Threshold must be between 0 and 1" }
        require(minAttempts >= 1) { "Minimum attempts must be positive" }
        return getAll(context)
            .filter { it.attempts >= minAttempts && it.accuracy < threshold }
            .mapTo(linkedSetOf(), CharacterProgress::char)
    }

    @Synchronized
    fun completedLesson(context: Context, lessonId: Int): Boolean {
        return preferences(context).getBoolean(completedLessonKey(lessonId), false)
    }

    @Synchronized
    fun setCompletedLesson(
        context: Context,
        lessonId: Int,
        completed: Boolean = true
    ) {
        preferences(context)
            .edit()
            .putBoolean(completedLessonKey(lessonId), completed)
            .apply()
    }

    @Synchronized
    fun clear(context: Context) {
        preferences(context).edit().clear().apply()
    }

    private fun preferences(context: Context) = context.applicationContext
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private fun attemptsKey(code: Int) = "$ATTEMPTS_PREFIX$code"

    private fun correctKey(code: Int) = "$CORRECT_PREFIX$code"

    private fun completedLessonKey(lessonId: Int) = "$LESSON_PREFIX$lessonId"

    private const val PREFERENCES_NAME = "taplab_training_progress"
    private const val ATTEMPTS_PREFIX = "char_attempts_"
    private const val CORRECT_PREFIX = "char_correct_"
    private const val LESSON_PREFIX = "lesson_completed_"
}
