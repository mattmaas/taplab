package com.maasailabs.taplab.companion

import android.content.Context
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

internal object DiagnosticLog {
    @Synchronized
    fun append(context: Context, message: String): String {
        val timestamp = SimpleDateFormat(
            TIMESTAMP_FORMAT,
            Locale.getDefault()
        ).format(Date())
        val normalizedMessage = message.replace(NEWLINE_REGEX, " | ")
        val formattedLine = truncateUtf8(
            "$timestamp $normalizedMessage",
            MAX_BYTES - NEWLINE_BYTE_COUNT
        )

        runCatching {
            val lines = ArrayDeque<String>()
            readInternal(context)
                .lineSequence()
                .filter(String::isNotEmpty)
                .forEach { line ->
                    lines.addLast(truncateUtf8(line, MAX_BYTES - NEWLINE_BYTE_COUNT))
                }
            lines.addLast(formattedLine)
            trim(lines)
            writeSafely(context, lines.joinToString(separator = "\n", postfix = "\n"))
        }

        return formattedLine
    }

    @Synchronized
    fun read(context: Context): String {
        return runCatching { readInternal(context) }.getOrDefault("")
    }

    @Synchronized
    fun clear(context: Context) {
        runCatching {
            val file = File(context.filesDir, FILE_NAME)
            if (file.exists() && !file.delete()) {
                context.openFileOutput(FILE_NAME, Context.MODE_PRIVATE).use {
                    it.write(ByteArray(0))
                }
            }
            File(context.filesDir, TEMP_FILE_NAME).delete()
        }
    }

    private fun readInternal(context: Context): String {
        val file = File(context.filesDir, FILE_NAME)
        if (!file.exists()) return ""
        return file.readText(Charsets.UTF_8)
    }

    private fun trim(lines: ArrayDeque<String>) {
        var byteCount = lines.sumOf(::persistedByteCount)
        while (lines.size > MAX_LINES || byteCount > MAX_BYTES) {
            byteCount -= persistedByteCount(lines.removeFirst())
        }
    }

    private fun persistedByteCount(line: String): Int {
        return line.toByteArray(Charsets.UTF_8).size + NEWLINE_BYTE_COUNT
    }

    private fun writeSafely(context: Context, content: String) {
        val target = File(context.filesDir, FILE_NAME)
        val temporary = File(context.filesDir, TEMP_FILE_NAME)

        try {
            temporary.outputStream().buffered().use { output ->
                output.write(content.toByteArray(Charsets.UTF_8))
                output.flush()
            }

            runCatching {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE
                )
            }.getOrElse {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING
                )
            }
        } finally {
            temporary.delete()
        }
    }

    private fun truncateUtf8(value: String, maxBytes: Int): String {
        if (value.toByteArray(Charsets.UTF_8).size <= maxBytes) return value

        val suffix = "…"
        val suffixBytes = suffix.toByteArray(Charsets.UTF_8).size
        val contentBudget = (maxBytes - suffixBytes).coerceAtLeast(0)
        val result = StringBuilder()
        var byteCount = 0
        var offset = 0

        while (offset < value.length) {
            val codePoint = value.codePointAt(offset)
            val characters = String(Character.toChars(codePoint))
            val characterBytes = characters.toByteArray(Charsets.UTF_8).size
            if (byteCount + characterBytes > contentBudget) break
            result.append(characters)
            byteCount += characterBytes
            offset += Character.charCount(codePoint)
        }

        if (suffixBytes <= maxBytes) {
            result.append(suffix)
        }
        return result.toString()
    }

    private const val FILE_NAME = "taplab-diagnostic.log"
    private const val TEMP_FILE_NAME = "$FILE_NAME.tmp"
    private const val TIMESTAMP_FORMAT = "HH:mm:ss.SSS"
    private const val MAX_LINES = 500
    private const val MAX_BYTES = 64 * 1024
    private const val NEWLINE_BYTE_COUNT = 1
    private val NEWLINE_REGEX = Regex("""[\r\n]+""")
}
