package com.maasailabs.taplab.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (
            action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        if (!CompanionSettings.autoStartOnBootEnabled(context)) return

        DiagnosticLog.append(
            context,
            "[Boot] Starting TapLab override after $action"
        )

        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, TapOverrideService::class.java)
            )
        } catch (error: Exception) {
            val reason = error.message ?: error.javaClass.simpleName
            DiagnosticLog.append(context, "[Boot] Auto-start failed: $reason")
        }
    }
}
