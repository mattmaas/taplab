package com.maasailabs.taplab.companion

import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.slider.Slider
import java.lang.ref.WeakReference
import java.util.Locale

class TapCodeTrainerActivity : AppCompatActivity() {
    private lateinit var statusView: TextView
    private lateinit var lessonSpinner: Spinner
    private lateinit var promptCountLabel: TextView
    private lateinit var promptCountSlider: Slider
    private lateinit var promptView: TextView
    private lateinit var typedProgressView: TextView
    private lateinit var hintView: TextView
    private lateinit var progressView: TextView
    private lateinit var progressBar: LinearProgressIndicator
    private lateinit var statCompleted: TextView
    private lateinit var statClean: TextView
    private lateinit var statErrors: TextView
    private lateinit var statsDetailView: TextView

    private var prompts: List<String> = emptyList()
    private var activeLesson: TapCodeLesson? = null
    private var promptIndex = 0
    private var typedIndex = 0
    private var completedPrompts = 0
    private var cleanPrompts = 0
    private var errorCount = 0
    private var currentPromptHadError = false
    private var ownsTrainingSession = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_trainer)

        bindViews()
        wireLessonSetup()
        wireActions()

        findViewById<TextView>(R.id.trainer_grid_reference).text = GRID_REFERENCE

        renderIdleState(
            if (TapOverrideService.isTraining()) {
                "A training session is active. Start a lesson to reconnect this screen."
            } else {
                "Choose a lesson and start training."
            }
        )
    }

    override fun onDestroy() {
        if (isFinishing && ownsTrainingSession) {
            TapOverrideService.endTraining()
            ownsTrainingSession = false
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        stopTraining("Training stopped.")
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    private fun bindViews() {
        statusView = findViewById(R.id.trainer_status)
        lessonSpinner = findViewById(R.id.lesson_spinner)
        promptCountLabel = findViewById(R.id.label_prompt_count)
        promptCountSlider = findViewById(R.id.slider_prompt_count)
        promptView = findViewById(R.id.trainer_prompt)
        typedProgressView = findViewById(R.id.trainer_typed)
        hintView = findViewById(R.id.trainer_hint)
        progressView = findViewById(R.id.trainer_progress)
        progressBar = findViewById(R.id.trainer_progress_bar)
        statCompleted = findViewById(R.id.stat_completed)
        statClean = findViewById(R.id.stat_clean)
        statErrors = findViewById(R.id.stat_errors)
        statsDetailView = findViewById(R.id.trainer_stats_detail)
    }

    private fun wireLessonSetup() {
        lessonSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            TapCodeCurriculum.LESSONS.map { "${it.id}. ${it.name}" }
        )

        renderPromptCountLabel(promptCountSlider.value.toInt())
        promptCountSlider.value = DEFAULT_PROMPT_COUNT.toFloat()
        renderPromptCountLabel(DEFAULT_PROMPT_COUNT)
        promptCountSlider.addOnChangeListener { _, value, _ ->
            renderPromptCountLabel(value.toInt())
        }
    }

    private fun wireActions() {
        findViewById<MaterialButton>(R.id.btn_start_lesson).setOnClickListener {
            startSelectedLesson()
        }

        findViewById<MaterialButton>(R.id.btn_drill_weak).setOnClickListener {
            startWeakCharacterDrill()
        }

        findViewById<MaterialButton>(R.id.btn_stop_lesson).setOnClickListener {
            stopTraining("Training stopped.")
        }

        findViewById<MaterialButton>(R.id.btn_back).setOnClickListener {
            stopTraining("Training stopped.")
            finish()
        }

        findViewById<MaterialButton>(R.id.btn_clear_progress).setOnClickListener {
            confirmClearProgress()
        }
    }

    private fun renderPromptCountLabel(count: Int) {
        promptCountLabel.text = "Prompts per session · $count"
    }

    private fun selectedPromptCount(): Int = promptCountSlider.value.toInt()

    private fun startSelectedLesson() {
        val lesson = TapCodeCurriculum.LESSONS[lessonSpinner.selectedItemPosition]
        startLesson(
            lesson,
            TapCodeCurriculum.randomizedPrompts(
                lesson,
                selectedPromptCount(),
                TrainingProgressStore.weakChars(applicationContext)
            )
        )
    }

    private fun startWeakCharacterDrill() {
        val weakChars = TrainingProgressStore.weakChars(applicationContext)
        if (weakChars.isEmpty()) {
            statusView.text =
                "No weak characters yet. Each character needs at least 3 attempts."
            return
        }

        val selectedLesson =
            TapCodeCurriculum.LESSONS[lessonSpinner.selectedItemPosition]
        val selectedCharacters = selectedLesson.prompts
            .mapNotNull(String::singleOrNull)
            .filterTo(linkedSetOf()) { it in weakChars }
        val drillCharacters = if (
            selectedLesson.kind == TapCodeLessonKind.CHARACTER &&
            selectedCharacters.isNotEmpty()
        ) {
            selectedCharacters
        } else {
            weakChars
        }
        val drillLesson = TapCodeLesson(
            id = selectedLesson.id,
            name = "Weak character drill",
            description = "Accuracy-focused review of weak characters.",
            prompts = drillCharacters.map(Char::toString),
            kind = TapCodeLessonKind.CHARACTER
        )
        startLesson(
            drillLesson,
            TapCodeCurriculum.randomizedPrompts(
                drillLesson,
                selectedPromptCount(),
                drillCharacters
            )
        )
    }

    private fun startLesson(lesson: TapCodeLesson, lessonPrompts: List<String>) {
        ContextCompat.startForegroundService(
            this,
            Intent(this, TapOverrideService::class.java)
        )

        activeLesson = lesson
        prompts = lessonPrompts
        promptIndex = 0
        typedIndex = 0
        completedPrompts = 0
        cleanPrompts = 0
        errorCount = 0
        currentPromptHadError = false
        ownsTrainingSession = true

        val activityReference = WeakReference(this)
        TapOverrideService.beginTraining { event ->
            activityReference.get()?.runOnUiThread {
                activityReference.get()?.handleTrainingEvent(event)
            }
        }

        statusView.text = "Training active. System text injection is suspended."
        renderCurrentPrompt()
    }

    private fun handleTrainingEvent(event: TapCodeEvent) {
        if (!ownsTrainingSession || prompts.isEmpty()) return

        when (event) {
            is TapCodeEvent.Commit -> event.text.forEach(::scoreCharacter)
            is TapCodeEvent.Action -> scoreCharacter(
                when (event.action) {
                    TapAction.BACKSPACE -> '\b'
                    TapAction.ENTER -> '\n'
                }
            )

            TapCodeEvent.Cancel -> resetCurrentAttempt(
                "Sequence canceled. Retry the prompt."
            )

            is TapCodeEvent.Error -> resetCurrentAttempt(
                "Decoder error: ${event.reason}. Retry the prompt."
            )

            TapCodeEvent.ModeToggle -> {
                stopTraining("MR+MR received. Training stopped.")
            }

            is TapCodeEvent.Pending -> {
                statusView.text = if (event.display.isEmpty()) {
                    "Training active."
                } else {
                    "Pending: ${event.display}"
                }
            }
        }
    }

    private fun scoreCharacter(received: Char) {
        val prompt = prompts.getOrNull(promptIndex) ?: return
        val expected = prompt[typedIndex]

        if (received == expected) {
            TrainingProgressStore.record(applicationContext, expected, true)
            typedIndex += 1
            statusView.text = "Correct: ${displayCharacter(received)}"
            if (typedIndex == prompt.length) {
                completePrompt()
            } else {
                renderCurrentPrompt()
            }
            return
        }

        TrainingProgressStore.record(applicationContext, expected, false)
        errorCount += 1
        currentPromptHadError = true
        typedIndex = 0
        statusView.text =
            "Expected ${displayCharacter(expected)}, received " +
            "${displayCharacter(received)}. Retry from the start."
        renderCurrentPrompt(preserveStatus = true)
    }

    private fun completePrompt() {
        completedPrompts += 1
        if (!currentPromptHadError) cleanPrompts += 1
        updateStats()

        if (completedPrompts >= prompts.size) {
            activeLesson?.let {
                TrainingProgressStore.setCompletedLesson(
                    applicationContext,
                    it.id
                )
            }
            finishLesson()
            return
        }

        promptIndex += 1
        typedIndex = 0
        currentPromptHadError = false
        statusView.text = "Prompt complete. Next prompt:"
        renderCurrentPrompt(preserveStatus = true)
    }

    private fun finishLesson() {
        TapOverrideService.endTraining()
        ownsTrainingSession = false
        promptView.text = "Complete"
        typedProgressView.text = ""
        hintView.text = ""
        progressView.text = "$completedPrompts of ${prompts.size} prompts completed"
        progressBar.setProgressCompat(100, true)
        statusView.text = "Training complete. Previous Tap mode restored."
        statsDetailView.text = buildSummary()
    }

    private fun stopTraining(message: String) {
        if (ownsTrainingSession || TapOverrideService.isTraining()) {
            TapOverrideService.endTraining()
        }
        ownsTrainingSession = false
        prompts = emptyList()
        activeLesson = null
        renderIdleState(message)
    }

    private fun resetCurrentAttempt(message: String) {
        typedIndex = 0
        currentPromptHadError = true
        statusView.text = message
        renderCurrentPrompt(preserveStatus = true)
    }

    private fun renderCurrentPrompt(preserveStatus: Boolean = false) {
        val prompt = prompts.getOrNull(promptIndex) ?: return
        if (!preserveStatus) {
            statusView.text = "Enter the displayed prompt."
        }
        promptView.text = TapCodeCurriculum.displayPrompt(prompt)
        typedProgressView.text = if (typedIndex == 0) {
            ""
        } else {
            TapCodeCurriculum.displayPrompt(prompt.substring(0, typedIndex))
        }
        hintView.text = TapCodeCurriculum.hintFor(prompt)
        progressView.text =
            "Prompt ${promptIndex + 1} of ${prompts.size} · " +
            "character ${typedIndex + 1} of ${prompt.length}"

        val percent = if (prompts.isEmpty()) {
            0
        } else {
            (completedPrompts * 100) / prompts.size
        }
        progressBar.setProgressCompat(percent, true)
        updateStats()
    }

    private fun updateStats() {
        statCompleted.text = completedPrompts.toString()
        statClean.text = cleanPrompts.toString()
        statErrors.text = errorCount.toString()
    }

    private fun buildSummary(): String {
        val progress = TrainingProgressStore.getAll(applicationContext)
        val weak = TrainingProgressStore.weakChars(applicationContext)
        val characterSummary = if (progress.isEmpty()) {
            "No character statistics recorded."
        } else {
            progress.joinToString("\n") {
                "${displayCharacter(it.char)}: " +
                    "${formatAccuracy(it.accuracy)} (${it.correct}/${it.attempts})"
            }
        }
        val weakSummary = if (weak.isEmpty()) {
            "none"
        } else {
            weak.joinToString(", ") { displayCharacter(it) }
        }
        return """
            Weak characters: $weakSummary

            Cumulative accuracy, worst first:
            $characterSummary
        """.trimIndent()
    }

    private fun renderIdleState(message: String) {
        statusView.text = message
        promptView.text = "Ready"
        typedProgressView.text = ""
        hintView.text = ""
        progressView.text = ""
        progressBar.setProgressCompat(0, false)
        completedPrompts = 0
        cleanPrompts = 0
        errorCount = 0
        updateStats()
        statsDetailView.text = cumulativeStats()
    }

    private fun cumulativeStats(): String {
        val progress = TrainingProgressStore.getAll(applicationContext)
        if (progress.isEmpty()) return "No training progress recorded."
        return progress.joinToString(
            separator = "\n",
            prefix = "Cumulative accuracy, worst first:\n"
        ) {
            "${displayCharacter(it.char)}: " +
                "${formatAccuracy(it.accuracy)} (${it.correct}/${it.attempts})"
        }
    }

    private fun confirmClearProgress() {
        AlertDialog.Builder(this)
            .setTitle("Clear training progress?")
            .setMessage(
                "All character accuracy and completed lesson data will be removed."
            )
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Clear") { _, _ ->
                TrainingProgressStore.clear(applicationContext)
                statsDetailView.text = "No training progress recorded."
                statusView.text = "Training progress cleared."
            }
            .show()
    }

    private fun displayCharacter(character: Char): String {
        return TapCodeCurriculum.displayPrompt(character.toString())
    }

    private fun formatAccuracy(accuracy: Double): String {
        return String.format(Locale.US, "%.0f%%", accuracy * 100.0)
    }

    private companion object {
        const val DEFAULT_PROMPT_COUNT = 20

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
            MR + MR       stop trainer
        """.trimIndent()
    }
}
