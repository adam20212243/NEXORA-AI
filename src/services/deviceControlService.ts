import type { DeviceControlCommand } from '../shared/types.ts';

export function detectClientPlatform(): DeviceControlCommand['targetPlatform'] {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'web';
}

export function isSafeLaunchUri(uri: string): boolean {
  const lower = uri.trim().toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }
  return true;
}

export interface DeviceLaunchResult {
  executed: boolean;
  method: 'android_bridge' | 'external_link' | 'protocol_handler' | 'blocked';
  messageAr: string;
  messageEn: string;
}

export async function executeConfirmedDeviceCommand(
  cmd: DeviceControlCommand
): Promise<DeviceLaunchResult> {
  if (!cmd.supportedOnCurrentPlatform || !cmd.launchUri) {
    return {
      executed: false,
      method: 'blocked',
      messageAr: cmd.messageAr,
      messageEn: cmd.messageEn,
    };
  }

  if (!isSafeLaunchUri(cmd.launchUri)) {
    return {
      executed: false,
      method: 'blocked',
      messageAr: 'تم حظر الرابط لأنه يستخدم مخططًا غير آمن.',
      messageEn: 'Blocked launch URI due to unsafe scheme.',
    };
  }

  // 1. Native Android WebView Bridge (if running inside Android wrapper)
  if (
    cmd.targetPlatform === 'android' &&
    window.NexoraAndroidBridge?.launchApp &&
    cmd.androidPackage
  ) {
    const launched = window.NexoraAndroidBridge.launchApp(
      cmd.androidPackage,
      cmd.androidIntentUri ?? cmd.launchUri
    );
    if (launched) {
      return {
        executed: true,
        method: 'android_bridge',
        messageAr: `تم إرسال أمر فتح ${cmd.matchedAppLabel ?? cmd.extractedAppName} إلى جسر Android الأصلي.`,
        messageEn: `Launched ${cmd.matchedAppLabel ?? cmd.extractedAppName} via Android native bridge.`,
      };
    }
  }

  // 2. HTTPS Deep Link / Web App Launch (via safe anchor element without window.open)
  if (cmd.launchUri.startsWith('https://') || cmd.launchUri.startsWith('http://')) {
    const anchor = document.createElement('a');
    anchor.href = cmd.launchUri;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return {
      executed: true,
      method: 'external_link',
      messageAr: `تم فتح ${cmd.matchedAppLabel ?? cmd.extractedAppName} عبر الرابط الآمن (${cmd.launchUri}).`,
      messageEn: `Opened ${cmd.matchedAppLabel ?? cmd.extractedAppName} via safe external link.`,
    };
  }

  // 3. OS Custom Protocol Handler (e.g., whatsapp://, spotify://, ms-settings:, calculator:, intent://)
  // Note: Browser security requires a direct user click gesture and may prompt OS confirmation.
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = cmd.launchUri;
    document.body.appendChild(iframe);
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1500);

    return {
      executed: true,
      method: 'protocol_handler',
      messageAr: `تم إرسال بروتوكول التشغيل (${cmd.launchUri}) إلى نظام التشغيل. إذا لم يظهر التطبيق، تأكد من تثبيته على جهازك أو استخدام الجسر المحلي لنظام Windows/Android.`,
      messageEn: `Dispatched OS protocol (${cmd.launchUri}). If the app does not appear, verify it is installed or enable the Windows/Android companion bridge.`,
    };
  } catch {
    return {
      executed: false,
      method: 'blocked',
      messageAr: 'منع المتصفح إطلاق البروتوكول المحلي تلقائيًا. استخدم الجسر المحلي الموثوق أو افتح التطبيق يدويًا.',
      messageEn: 'Browser blocked automatic local protocol launch. Use the local companion bridge or open manually.',
    };
  }
}
