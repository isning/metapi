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
            toast.error(err?.message || '加载通知设置失败');
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
            toast.success('通知设置已保存');
        } catch (err: any) {
            toast.error(err?.message || '保存失败');
        } finally {
            setSavingNotify(false);
        }
    };

    const testNotify = async () => {
        setTestingNotify(true);
        try {
            const res = await api.testNotification();
            toast.success(res?.message || '测试通知已发送');
        } catch (err: any) {
            toast.error(err?.message || '触发测试通知失败');
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
                <h2 className="text-2xl font-semibold tracking-tight">{tr('通知设置')}</h2>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={testNotify} disabled={testingNotify}>
                        {testingNotify ? <><LoaderCircle className="size-4 animate-spin" /> 发送中...</> : '发送测试通知'}
                    </Button>
                    <Button type="button" onClick={saveNotify} disabled={savingNotify}>
                        {savingNotify ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存通知设置'}
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>告警去噪与冷静期</CardTitle>
                    <CardDescription>相同告警在冷静期内不会重复推送；冷静期结束后会自动合并重复条数。</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="max-w-xs">
                        {field(
                            '冷静期（秒）',
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
                            <CardDescription>通过 HTTP URL 推送消息通知（自动识别企业微信、飞书格式）</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            {toggleRow('启用 Webhook', runtime.webhookEnabled, (checked) => setRuntime((prev) => ({ ...prev, webhookEnabled: checked })))}
                            {toggleRow('启用 Bark', runtime.barkEnabled, (checked) => setRuntime((prev) => ({ ...prev, barkEnabled: checked })))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                    {field(
                        'Webhook URL',
                        <Input
                            value={runtime.webhookUrl}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                            placeholder="https://your-webhook-url (可选)"
                            disabled={!runtime.webhookEnabled}
                        />,
                    )}
                    {field(
                        'Bark URL',
                        <Input
                            value={runtime.barkUrl}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, barkUrl: e.target.value }))}
                            placeholder="https://api.day.app/your_key (可选)"
                            disabled={!runtime.barkEnabled}
                        />,
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>Server酱 (SendKey)</CardTitle>
                            <CardDescription>微信推送消息支持。当前配置：{runtime.serverChanKeyMasked || '未设置'}</CardDescription>
                        </div>
                        {toggleRow('启用 Server酱', runtime.serverChanEnabled, (checked) => setRuntime((prev) => ({ ...prev, serverChanEnabled: checked })))}
                    </div>
                </CardHeader>
                <CardContent>
                    {field(
                        'Server酱 Key',
                        <Input
                            type="password"
                            value={serverChanKey}
                            onChange={(e) => setServerChanKey(e.target.value)}
                            placeholder="输入新的 Server酱 Key（留空则不改）"
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
                            <CardDescription>通过 Telegram 机器人推送消息通知</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            {toggleRow('使用系统代理', runtime.telegramUseSystemProxy, (checked) => setRuntime((prev) => ({ ...prev, telegramUseSystemProxy: checked })))}
                            {toggleRow('启用 Telegram', runtime.telegramEnabled, (checked) => setRuntime((prev) => ({ ...prev, telegramEnabled: checked })))}
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
                                placeholder="例如: https://your-proxy.example.com"
                                disabled={!runtime.telegramEnabled}
                            />,
                            '留空或使用默认值时直连官方 Telegram API；如需国内反代，可填写反代前缀。',
                        )}
                    </div>
                    {field(
                        'Telegram Chat ID',
                        <Input
                            value={runtime.telegramChatId}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, telegramChatId: e.target.value }))}
                            placeholder="例如: -1001234567890 或 @your_channel"
                            disabled={!runtime.telegramEnabled}
                        />,
                    )}
                    {field(
                        'Telegram Topic ID',
                        <Input
                            value={runtime.telegramMessageThreadId}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, telegramMessageThreadId: e.target.value }))}
                            placeholder="例如: 77"
                            disabled={!runtime.telegramEnabled}
                        />,
                    )}
                    {field(
                        `Telegram Bot Token${runtime.telegramBotTokenMasked ? '（当前已设置）' : ''}`,
                        <Input
                            type="password"
                            value={telegramBotToken}
                            onChange={(e) => setTelegramBotToken(e.target.value)}
                            placeholder="输入新的 Bot Token（留空则不改）"
                            disabled={!runtime.telegramEnabled}
                        />,
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>邮件服务 (SMTP)</CardTitle>
                            <CardDescription>通过电子邮件推送提醒</CardDescription>
                        </div>
                        {toggleRow('启用 SMTP', runtime.smtpEnabled, (checked) => setRuntime((prev) => ({ ...prev, smtpEnabled: checked })))}
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    {field(
                        'SMTP 服务器',
                        <Input
                            value={runtime.smtpHost}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpHost: e.target.value }))}
                            placeholder="例如: smtp.qq.com"
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    <div className="grid gap-2">
                        <Label>端口</Label>
                        <div className="flex items-center gap-4">
                            <Input
                                type="number"
                                min={1}
                                value={runtime.smtpPort}
                                onChange={(e) => setRuntime((prev) => ({ ...prev, smtpPort: Number(e.target.value) || 0 }))}
                                disabled={!runtime.smtpEnabled}
                            />
                            {toggleRow('启用 TLS/SSL', runtime.smtpSecure, (checked) => setRuntime((prev) => ({ ...prev, smtpSecure: checked })), !runtime.smtpEnabled)}
                        </div>
                    </div>
                    {field(
                        '账号用户',
                        <Input
                            value={runtime.smtpUser}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpUser: e.target.value }))}
                            placeholder="SMTP 用户名"
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    {field(
                        `账号密码${runtime.smtpPassMasked ? '（当前已设置）' : ''}`,
                        <Input
                            type="password"
                            value={smtpPass}
                            onChange={(e) => setSmtpPass(e.target.value)}
                            placeholder="输入以更改密码..."
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    {field(
                        '发件人地址',
                        <Input
                            value={runtime.smtpFrom}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpFrom: e.target.value }))}
                            placeholder="例如: admin@example.com"
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                    {field(
                        '接收地址',
                        <Input
                            value={runtime.smtpTo}
                            onChange={(e) => setRuntime((prev) => ({ ...prev, smtpTo: e.target.value }))}
                            placeholder="例如: target@example.com"
                            disabled={!runtime.smtpEnabled}
                        />,
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
