import { useEffect, useState } from 'react';
import { api, type RuntimeSettingsPayload } from '../api.js';
import { useToast } from '../components/Toast.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Input } from '../components/ui/input/index.js';
import { Label } from '../components/ui/label/index.js';
import { Switch } from '../components/ui/switch/index.js';

type RuntimeSettings = {
    webhookUrl: string;
    barkUrl: string;
    webhookEnabled: boolean;
    barkEnabled: boolean;
    serverChanEnabled: boolean;
    telegramEnabled: boolean;
    telegramApiBaseUrl: string;
    telegramChatId: string;
    telegramUseSystemProxy: boolean;
    telegramMessageThreadId: string;
    smtpEnabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassMasked?: string;
    smtpFrom: string;
    smtpTo: string;
    serverChanKeyMasked?: string;
    telegramBotTokenMasked?: string;
    notifyCooldownSec: number;
};

export default function NotificationSettings() {
    const [runtime, setRuntime] = useState<RuntimeSettings>({
        webhookUrl: '',
        barkUrl: '',
        webhookEnabled: true,
        barkEnabled: true,
        serverChanEnabled: false,
        telegramEnabled: false,
        telegramApiBaseUrl: 'https://api.telegram.org',
        telegramChatId: '',
        telegramUseSystemProxy: false,
        telegramMessageThreadId: '',
        smtpEnabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: '',
        smtpFrom: '',
        smtpTo: '',
        notifyCooldownSec: 300,
    });

    const [serverChanKey, setServerChanKey] = useState('');
    const [telegramBotToken, setTelegramBotToken] = useState('');
    const [smtpPass, setSmtpPass] = useState('');
    const [loading, setLoading] = useState(true);
    const [savingNotify, setSavingNotify] = useState(false);
    const [testingNotify, setTestingNotify] = useState(false);
    const toast = useToast();

    const loadSettings = async () => {
        setLoading(true);
        try {
            const runtimeInfo = await api.getRuntimeSettings();
            setRuntime({
                webhookUrl: runtimeInfo.webhookUrl || '',
                barkUrl: runtimeInfo.barkUrl || '',
                webhookEnabled: runtimeInfo.webhookEnabled ?? true,
                barkEnabled: runtimeInfo.barkEnabled ?? true,
                serverChanEnabled: !!runtimeInfo.serverChanEnabled,
                telegramEnabled: !!runtimeInfo.telegramEnabled,
                telegramApiBaseUrl: runtimeInfo.telegramApiBaseUrl || 'https://api.telegram.org',
                telegramChatId: runtimeInfo.telegramChatId || '',
                telegramUseSystemProxy: !!runtimeInfo.telegramUseSystemProxy,
                telegramMessageThreadId: runtimeInfo.telegramMessageThreadId || '',
                smtpEnabled: !!runtimeInfo.smtpEnabled,
                smtpHost: runtimeInfo.smtpHost || '',
                smtpPort: Number(runtimeInfo.smtpPort) || 587,
                smtpSecure: !!runtimeInfo.smtpSecure,
                smtpUser: runtimeInfo.smtpUser || '',
                smtpPassMasked: runtimeInfo.smtpPassMasked || '',
                smtpFrom: runtimeInfo.smtpFrom || '',
                smtpTo: runtimeInfo.smtpTo || '',
                serverChanKeyMasked: runtimeInfo.serverChanKeyMasked || '',
                telegramBotTokenMasked: runtimeInfo.telegramBotTokenMasked || '',
                notifyCooldownSec: Number.isFinite(Number(runtimeInfo.notifyCooldownSec))
                    ? Math.max(0, Math.trunc(Number(runtimeInfo.notifyCooldownSec)))
                    : 300,
            });
        } catch (err: any) {
            toast.error(err?.message || tr('pages.notificationSettings.failedLoadNotificationSettings'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const saveNotify = async () => {
        setSavingNotify(true);
        try {
            const payload: RuntimeSettingsPayload = {
                webhookUrl: runtime.webhookUrl,
                barkUrl: runtime.barkUrl,
                webhookEnabled: runtime.webhookEnabled,
                barkEnabled: runtime.barkEnabled,
                serverChanEnabled: runtime.serverChanEnabled,
                telegramEnabled: runtime.telegramEnabled,
                telegramApiBaseUrl: runtime.telegramApiBaseUrl,
                telegramChatId: runtime.telegramChatId,
                telegramUseSystemProxy: runtime.telegramUseSystemProxy,
                telegramMessageThreadId: runtime.telegramMessageThreadId,
                smtpEnabled: runtime.smtpEnabled,
                smtpHost: runtime.smtpHost,
                smtpPort: runtime.smtpPort,
                smtpSecure: runtime.smtpSecure,
                smtpUser: runtime.smtpUser,
                smtpFrom: runtime.smtpFrom,
                smtpTo: runtime.smtpTo,
                notifyCooldownSec: Math.max(0, Math.trunc(Number(runtime.notifyCooldownSec) || 0)),
            };
            if (serverChanKey.trim()) payload.serverChanKey = serverChanKey.trim();
            if (telegramBotToken.trim()) payload.telegramBotToken = telegramBotToken.trim();
            if (smtpPass.trim()) payload.smtpPass = smtpPass.trim();

            const res = await api.updateRuntimeSettings(payload);
            setRuntime((prev) => ({
                ...prev,
                serverChanKeyMasked: res.serverChanKeyMasked || prev.serverChanKeyMasked,
                telegramBotTokenMasked: res.telegramBotTokenMasked || prev.telegramBotTokenMasked,
                smtpPassMasked: res.smtpPassMasked || prev.smtpPassMasked,
            }));
            setServerChanKey('');
            setTelegramBotToken('');
            setSmtpPass('');
            toast.success(tr('pages.notificationSettings.notificationSettingsSaved'));
        } catch (err: any) {
            toast.error(err?.message || tr('pages.accounts.saveFailed'));
        } finally {
            setSavingNotify(false);
        }
    };

    const testNotify = async () => {
        setTestingNotify(true);
        try {
            const res = await api.testNotification();
            toast.success(res?.message || tr('pages.notificationSettings.testNotificationSent'));
        } catch (err: any) {
            toast.error(err?.message || tr('pages.notificationSettings.triggerTestNotificationFailed'));
        } finally {
            setTestingNotify(false);
        }
    };

    const toggleRow = (
        label: string,
        checked: boolean,
        onCheckedChange: (checked: boolean) => void,
        disabled = false,
    ) => (
        <div className="flex items-center gap-2">
            <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    );

    const field = (
        label: string,
        input: JSX.Element,
        hint?: string,
    ) => (
        <div className="grid gap-2">
            <Label>{label}</Label>
            {input}
            {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
        </div>
    );

    if (loading) {
        return (
            <div className="grid gap-3">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-80 w-full" />
            </div>
        );
    }

    return (
        <div className="grid max-w-4xl gap-4 pb-10">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-2xl font-semibold tracking-tight">{tr('app.notificationSettings')}</h2>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={testNotify} disabled={testingNotify}>
                        {testingNotify ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.notificationSettings.sending')}</> : tr('pages.notificationSettings.sendTestNotification')}
                    </Button>
                    <Button type="button" onClick={saveNotify} disabled={savingNotify}>
                        {savingNotify ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.notificationSettings.saveNotificationSettings')}
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>{tr('pages.notificationSettings.alertDeduplicationCooldown')}</CardTitle>
                    <CardDescription>{tr('pages.notificationSettings.endAutomaticItems')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="max-w-xs">
                        {field(
                            tr('pages.notificationSettings.cooldownPeriodSeconds'),
                            <Input
                                type="number"
                                min={0}
                                value={runtime.notifyCooldownSec}
                                onChange={(e) => setRuntime((prev) => ({
                                    ...prev,
                                    notifyCooldownSec: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                }))}
                            />,
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>Webhook & Bark</CardTitle>
                            <CardDescription>{tr('pages.notificationSettings.httpUrlNotificationsAutomatic')}</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            {toggleRow(tr('pages.notificationSettings.enabledWebhook'), runtime.webhookEnabled, (checked) => setRuntime((prev) => ({ ...prev, webhookEnabled: checked })))}
                            {toggleRow(tr('pages.notificationSettings.enabledBark'), runtime.barkEnabled, (checked) => setRuntime((prev) => ({ ...prev, barkEnabled: checked })))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                    {field(
                        'Webhook URL',
                        <Input
                            value={runtime.webhookUrl}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.httpsYourWebhookUrlOptional')}
                            disabled={!runtime.webhookEnabled}
                        />,
                    )}
                    {field(
                        'Bark URL',
                        <Input
                            value={runtime.barkUrl}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, barkUrl: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.httpsApiDayAppYourKeyOptional')}
                            disabled={!runtime.barkEnabled}
                        />,
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>{tr('pages.notificationSettings.serverSendkey')}</CardTitle>
                            <CardDescription>{tr('pages.notificationSettings.supportedConfiguration')}{runtime.serverChanKeyMasked || tr('pages.notificationSettings.notSet')}</CardDescription>
                        </div>
                        {toggleRow(tr('pages.notificationSettings.enabledServer'), runtime.serverChanEnabled, (checked) => setRuntime((prev) => ({ ...prev, serverChanEnabled: checked })))}
                    </div>
                </CardHeader>
                <CardContent>
                    {field(
                        tr('pages.notificationSettings.serverKey'),
                        <Input
                            type="password"
                            value={serverChanKey}
                            onChange={(e) => setServerChanKey(e.target.value)}
                            placeholder={tr('pages.notificationSettings.enterNewServerKeyLeaveItBlank')}
                            disabled={!runtime.serverChanEnabled}
                        />,
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>Telegram Bot</CardTitle>
                            <CardDescription>{tr('pages.notificationSettings.telegramNotifications')}</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            {toggleRow(tr('pages.notificationSettings.usagesystemacting'), runtime.telegramUseSystemProxy, (checked) => setRuntime((prev) => ({ ...prev, telegramUseSystemProxy: checked })))}
                            {toggleRow(tr('pages.notificationSettings.enabledTelegram'), runtime.telegramEnabled, (checked) => setRuntime((prev) => ({ ...prev, telegramEnabled: checked })))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                        {field(
                            'Telegram API Base URL',
                            <Input
                                value={runtime.telegramApiBaseUrl}
                                onChange={(e) => setRuntime((prev) => ({ ...prev, telegramApiBaseUrl: e.target.value }))}
                                placeholder={tr('pages.notificationSettings.httpsYourProxyExampleCom')}
                                disabled={!runtime.telegramEnabled}
                            />,
                            tr('pages.notificationSettings.usagedefaultOfficialTelegramApi'),
                        )}
                    </div>
                    {field(
                        'Telegram Chat ID',
                        <Input
                            value={runtime.telegramChatId}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, telegramChatId: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.1001234567890YourChannel')}
                            disabled={!runtime.telegramEnabled}
                        />,
                    )}
                    {field(
                        'Telegram Topic ID',
                        <Input
                            value={runtime.telegramMessageThreadId}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, telegramMessageThreadId: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.77')}
                            disabled={!runtime.telegramEnabled}
                        />,
                    )}
                    {field(
                        `Telegram Bot Token${runtime.telegramBotTokenMasked ? tr('pages.notificationSettings.settings') : ''}`,
                        <Input
                            type="password"
                            value={telegramBotToken}
                            onChange={(e) => setTelegramBotToken(e.target.value)}
                            placeholder={tr('pages.notificationSettings.inputBotToken')}
                            disabled={!runtime.telegramEnabled}
                        />,
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>{tr('pages.notificationSettings.smtp2')}</CardTitle>
                            <CardDescription>{tr('pages.notificationSettings.sendRemindersEmail')}</CardDescription>
                        </div>
                        {toggleRow(tr('pages.notificationSettings.enabledSmtp'), runtime.smtpEnabled, (checked) => setRuntime((prev) => ({ ...prev, smtpEnabled: checked })))}
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    {field(
                        tr('pages.notificationSettings.smtp'),
                        <Input
                            value={runtime.smtpHost}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpHost: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.exampleSmtpQqCom')}
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    <div className="grid gap-2">
                        <Label>{tr('pages.notificationSettings.port')}</Label>
                        <div className="flex items-center gap-4">
                            <Input
                                type="number"
                                min={1}
                                value={runtime.smtpPort}
                                onChange={(e) => setRuntime((prev) => ({ ...prev, smtpPort: Number(e.target.value) || 0 }))}
                                disabled={!runtime.smtpEnabled}
                            />
                            {toggleRow(tr('pages.notificationSettings.enabledTlsSsl'), runtime.smtpSecure, (checked) => setRuntime((prev) => ({ ...prev, smtpSecure: checked })), !runtime.smtpEnabled)}
                        </div>
                    </div>
                    {field(
                        tr('pages.notificationSettings.accounts'),
                        <Input
                            value={runtime.smtpUser}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpUser: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.smtpUsername')}
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    {field(
                        `账号密码${runtime.smtpPassMasked ? tr('pages.notificationSettings.settings') : ''}`,
                        <Input
                            type="password"
                            value={smtpPass}
                            onChange={(e) => setSmtpPass(e.target.value)}
                            placeholder={tr('pages.notificationSettings.enterChangePassword')}
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    {field(
                        tr('pages.notificationSettings.senderAddress'),
                        <Input
                            value={runtime.smtpFrom}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpFrom: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.exampleAdminExampleCom')}
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    {field(
                        tr('pages.notificationSettings.receiverUrl'),
                        <Input
                            value={runtime.smtpTo}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpTo: e.target.value }))}
                            placeholder={tr('pages.notificationSettings.exampleTargetExampleCom')}
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
