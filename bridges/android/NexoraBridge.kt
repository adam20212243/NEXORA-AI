package com.nexora.ai.bridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import java.util.Locale

/**
 * NEXORA AI Native Android WebView Bridge
 * Supports direct app launching via PackageManager / Intents, natural TTS,
 * and ForegroundService background audio/wake-word coordination.
 */
class NexoraBridge(
    private val context: Context,
    private val tts: TextToSpeech,
    private val isForegroundServiceRunning: () -> Boolean
) {
    private val allowedPackages = setOf(
        "com.google.android.youtube",
        "com.android.chrome",
        "com.whatsapp",
        "org.telegram.messenger",
        "com.google.android.gm",
        "com.google.android.apps.maps",
        "com.spotify.music",
        "com.google.android.calculator",
        "com.android.settings",
        "com.github.android",
        "com.google.android.calendar",
        "com.android.camera"
    )

    @JavascriptInterface
    fun launchApp(packageName: String, intentUri: String): Boolean {
        if (!allowedPackages.contains(packageName)) {
            return false
        }
        return try {
            if (packageName == "com.android.settings") {
                val settingsIntent = Intent(Settings.ACTION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(settingsIntent)
                return true
            }
            val pm = context.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(launchIntent)
                true
            } else if (intentUri.isNotBlank()) {
                val uriIntent = Intent(Intent.ACTION_VIEW, Uri.parse(intentUri))
                uriIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(uriIntent)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun speakText(text: String, langTag: String, rate: Float): Boolean {
        return try {
            val locale = Locale.forLanguageTag(langTag)
            tts.language = locale
            tts.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nexora_utterance")
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        tts.stop()
    }

    @JavascriptInterface
    fun isBackgroundServiceActive(): Boolean = isForegroundServiceRunning()
}
