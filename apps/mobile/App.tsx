import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { applyEvent, emptySession } from '../../packages/core';
import type { Session } from '../../packages/core';
import { BridgeApi } from './src/api';
import type { Summary } from './src/api';
import { termux } from './src/native';
import type { Environment } from './src/native';
import { repositorySetup } from './src/setup';
import { version as appVersion } from './package.json';

function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function describe(error: unknown) {
  const nativeCode = (error as {code?: unknown} | null)?.code;
  const code = typeof nativeCode === 'string' ? nativeCode : error instanceof Error ? error.message : '';
  const known: Record<string, string> = {
    UNAUTHORIZED: '配对失效，请重新启动并配对。',
    PERMISSION_REQUIRED: '尚未取得系统的 Termux 命令权限，请在本 App 的附加权限中开启，返回后会自动刷新。',
    INVALID_SETTINGS: '仓库路径或 CLI 版本格式不正确。路径需在 Termux HOME 内，版本只填写数字版本号。',
    TERMUX_MISSING: '未检测到 Termux，请先安装并打开一次。',
    TERMUX_START_FAILED: '无法启动 Termux 操作，请核对仓库路径、CLI 版本及命令权限。',
    TERMUX_COMMAND_FAILED: 'Termux 命令未完成，请打开终端检查环境和登录状态。',
    TERMUX_TIMEOUT: 'Termux 未返回结果，请打开终端检查 allow-external-apps 配置和进程。',
    PAIRING_LOST: '配对信息无法解密，请重新启动并配对。',
    AGENT_BUSY: '另一个任务正在运行。',
    AGENT_UNAVAILABLE: 'CLI 暂不可用，请检查登录后重启服务。',
    PAIRING_EXPIRED: '服务已重启，请重新配对。',
    INTERRUPTED: '任务已中断，没有自动重发。',
    PERMISSION_EXPIRED: '权限请求已过期。',
  };
  return (
    known[code] ||
    (/^[A-Z_]+$/.test(code)
      ? `操作未完成：${code}`
      : '操作未完成，请检查 Termux、系统授权和登录状态。')
  );
}
function Mobile() {
  const [tab, setTab] = useState('environment');
  const [env, setEnv] = useState<Environment>({
    installed: false,
    permission: false,
    repo: '/data/data/com.termux/files/home/workbuddy-lite',
    version: '',
  });
  const [api, setApi] = useState<BridgeApi | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Summary[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('先连接本机运行环境');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const refreshGeneration = useRef(0);
  const settingsLoaded = useRef(false);
  async function refresh(loadSettings = false) {
    const generation = ++refreshGeneration.current;
    const environment = await termux.status();
    if (generation !== refreshGeneration.current) return;
    const restoreSettings = loadSettings || !settingsLoaded.current;
    settingsLoaded.current = true;
    setEnv(current => restoreSettings ? environment : {
      ...current,
      installed: environment.installed,
      permission: environment.permission,
    });
    const config = await termux.pairing();
    if (generation !== refreshGeneration.current) return;
    setApi(config ? new BridgeApi(config) : null);
  }
  const guard = (promise: Promise<unknown>) =>
    promise.catch(e => setError(describe(e)));
  useEffect(() => {
    guard(refresh(true));
    const listener = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'active') guard(refresh());
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!api || !foreground || demo) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    let epoch = '',
      cursor = 0,
      count = 0;
    async function snapshot() {
      const result = await api!.session(active);
      if (!disposed) {
        setSession(result.session);
        epoch = result.epoch;
        cursor = result.seq;
      }
    }
    async function poll() {
      try {
        const status = await api!.status();
        if (disposed) return;
        setReady(status.ready);
        setNotice(status.ready ? '本机 Agent 已连接' : 'CLI 启动中或等待登录');
        if (!status.ready) {
          if (status.agentError)
            setError(describe(new Error(status.agentError)));
          return;
        }
        if (count++ % 5 === 0) {
          const list = await api!.sessions();
          if (!disposed) setSessions(list.sessions);
        }
        if (active) {
          if (!epoch) await snapshot();
          else {
            const batch = await api!.events(epoch, cursor);
            if (disposed) return;
            if (batch.resync) await snapshot();
            else {
              setSession(current =>
                current
                  ? batch.events
                      .filter(e => e.sessionId === active)
                      .reduce(applyEvent, current)
                  : current,
              );
              epoch = batch.epoch;
              cursor = batch.seq;
            }
          }
        }
      } catch (e) {
        if (!disposed) {
          setReady(false);
          setError(describe(e));
          setNotice('连接中断 · 不会自动重发任务');
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, 1000);
      }
    }
    poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, active, foreground, demo]);
  async function action(name: string) {
    setBusy(true);
    setError('');
    try {
      await termux.saveSettings(env.repo, env.version);
      const result = await termux.launch(name, env.repo, env.version);
      if (result.launched) setNotice('已打开 Termux，请在终端完成操作后返回。');
      if (result.report)
        setNotice(
          JSON.parse(result.report).readyForSmoke
            ? '基础环境检查通过'
            : '环境仍有缺项，请在 Termux 查看 doctor 输出',
        );
      if (name === 'start' || name === 'stop') {
        await refresh();
        setReady(false);
      }
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!api || !ready) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.create();
      setSession(result.session);
      setActive(result.session.id);
      setTab('chat');
      attempt.current = null;
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!api || !session || !draft.trim() || demo) return;
    setBusy(true);
    const text = draft.trim();
    if (attempt.current?.text !== text)
      attempt.current = {
        text,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
      };
    try {
      await api.send(session.id, text, attempt.current.id);
      setDraft('');
      attempt.current = null;
    } catch (e) {
      setError(`${describe(e)} 结果不确定时，原文重试使用相同任务编号。`);
    } finally {
      setBusy(false);
    }
  }
  function showDemo() {
    const example = emptySession('demo', '', '');
    example.messages = [
      { id: '1', role: 'user', text: '检查项目并整理下一步任务' },
      {
        id: '2',
        role: 'tool',
        text: '',
        title: '读取项目文件',
        status: 'completed',
      },
      {
        id: '3',
        role: 'assistant',
        text: '这里会展示 Agent 的流式回答、工具执行与权限卡片。\n\n当前是演示数据，没有运行 CLI，也不会执行命令。',
      },
    ];
    setSession(example);
    setDemo(true);
    setTab('chat');
  }
  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <Text style={s.eyebrow}>WORKBUDDY / ANDROID</Text>
        <Text style={s.title}>你的本机工作台</Text>
      </View>
      <View style={s.row}>
        <Button label="运行环境" onPress={() => setTab('environment')} />
        <Button label="Agent 会话" onPress={() => setTab('chat')} />
      </View>
      <Text style={s.notice}>{demo ? '演示模式 · 不执行命令' : notice}</Text>
      {!!error && (
        <Pressable onPress={() => setError('')}>
          <Text style={s.error}>{error}</Text>
        </Pressable>
      )}
      {tab === 'environment' ? (
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.section}>01 连接 Termux</Text>
          <View style={s.card}>
            <Text style={s.cardTitle}>
              {env.installed ? '已检测到 Termux' : '需要安装 Termux'}
            </Text>
            <Text style={s.muted}>
              首次请克隆 main 分支，并在 Termux 设置 allow-external-apps=true。已有仓库可跳过克隆，以下为初始化命令。
            </Text>
            <Text testID="repository-setup" selectable style={s.code}>
              {repositorySetup}
            </Text>
            <Text style={s.muted}>
              {env.permission
                ? '命令权限已授予'
                : '尚未授予在 Termux 环境运行命令的权限'}
            </Text>
            <Button
              label="打开权限设置"
              onPress={() => guard(termux.openSettings())}
            />
            <Button
              label="打开 Termux"
              onPress={() => guard(termux.openTermux())}
            />
          </View>
          <Text style={s.section}>02 安装与登录</Text>
          <Text style={s.muted}>Termux 中的仓库绝对路径</Text>
          <TextInput
            accessibilityLabel="仓库路径"
            style={s.input}
            value={env.repo}
            onChangeText={repo => setEnv(current => ({ ...current, repo }))}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={s.muted}>CLI 精确版本（先用 npm view 查询）</Text>
          <TextInput
            accessibilityLabel="CLI 版本"
            style={s.input}
            placeholder="填写实际版本，如 x.y.z"
            placeholderTextColor="#728198"
            value={env.version}
            onChangeText={version => setEnv(current => ({ ...current, version }))}
            autoCapitalize="none"
          />
          <View style={s.row}>
            <Button
              label="安装 CLI"
              disabled={busy || !env.version}
              onPress={() => action('install')}
            />
            <Button
              label="登录账户"
              disabled={busy}
              onPress={() => action('login')}
            />
          </View>
          <Text style={s.muted}>
            安装和登录会打开终端，完成后请返回。已有 CLI
            服务需要停止并重新启动，才能重新检查登录。
          </Text>
          <Text style={s.section}>03 启动本机 Agent</Text>
          <Button
            label={busy ? '正在操作…' : '启动并安全配对'}
            disabled={busy}
            onPress={() => {
              setDemo(false);
              action('start');
            }}
          />
          <View style={s.row}>
            <Button
              label="环境诊断"
              disabled={busy}
              onPress={() => action('doctor')}
            />
            <Button
              label="停止服务"
              disabled={busy || !api}
              onPress={() => action('stop')}
            />
            <Button
              label="刷新检测"
              disabled={busy}
              onPress={() => guard(refresh())}
            />
          </View>
          <Button label="查看界面演示" onPress={showDemo} />
          <Text style={s.footnote}>
            开发预览 v{appVersion} · 工作目录：Termux HOME/WorkBuddy/mobile。后台运行受
            Android 限制，真机兼容性仍待验收。
          </Text>
        </ScrollView>
      ) : (
        <View style={s.chat}>
          <ScrollView horizontal style={s.strip}>
            <Button
              label="＋ 新会话"
              disabled={!ready || busy || demo}
              onPress={() => create()}
            />
            {sessions.map(item => (
              <Button
                key={item.id}
                label={item.title}
                onPress={() => {
                  setDemo(false);
                  setSession(null);
                  setActive(item.id);
                  attempt.current = null;
                }}
              />
            ))}
          </ScrollView>
          {session ? (
            <>
              <View style={s.heading}>
                <Text style={s.cardTitle}>{session.title}</Text>
                <Text style={s.muted}>
                  积分：
                  {session.credits === null
                    ? '待返回'
                    : session.credits.toFixed(3)}
                </Text>
              </View>
              {!!session.error && (
                <Text style={s.error}>
                  {describe(new Error(session.error))}
                </Text>
              )}
              <FlatList
                data={session.messages}
                keyExtractor={item => item.id}
                contentContainerStyle={s.messages}
                renderItem={({ item }) => (
                  <View
                    style={[s.bubble, item.role === 'user' && s.userBubble]}
                  >
                    <Text style={s.role}>
                      {
                        {
                          user: '你',
                          assistant: 'AGENT',
                          thought: '思考',
                          tool: '工具执行',
                        }[item.role]
                      }
                    </Text>
                    <Text selectable style={s.message}>
                      {item.role === 'tool'
                        ? `${item.title} · ${item.status}`
                        : item.text}
                    </Text>
                  </View>
                )}
              />
              {session.permissions.map(permission => (
                <View key={permission.id} style={s.permission}>
                  <Text style={s.cardTitle}>{permission.title}</Text>
                  <ScrollView style={s.permissionInput}>
                    <Text selectable style={s.code}>
                      {permission.input}
                    </Text>
                  </ScrollView>
                  <View style={s.row}>
                    {permission.options.map(option => (
                      <Button
                        key={option.optionId}
                        label={option.name || option.kind}
                        onPress={() =>
                          api &&
                          guard(
                            api.permission(
                              session.id,
                              permission.id,
                              option.optionId,
                            ),
                          )
                        }
                      />
                    ))}
                    <Button
                      label="取消"
                      onPress={() =>
                        api &&
                        guard(
                          api.permission(session.id, permission.id, null),
                        )
                      }
                    />
                  </View>
                </View>
              ))}
              {!!session.models.length && (
                <ScrollView horizontal style={s.strip}>
                  {session.models.map(model => (
                    <Button
                      key={model.modelId}
                      label={`${session.model === model.modelId ? '✓ ' : ''}${
                        model.name
                      }`}
                      disabled={session.running}
                      onPress={() =>
                        api &&
                        guard(
                          api
                            .model(session.id, model.modelId)
                            .then(() => api.session(session.id))
                            .then(result => setSession(result.session)),
                        )
                      }
                    />
                  ))}
                </ScrollView>
              )}
            </>
          ) : (
            <View style={s.empty}>
              <Text style={s.cardTitle}>让 Agent 开始工作</Text>
              <Text style={s.muted}>连接运行环境后，新建或选择会话。</Text>
            </View>
          )}
          <View style={s.composer}>
            <TextInput
              accessibilityLabel="任务输入"
              style={s.draft}
              placeholder="描述你要完成的任务…"
              placeholderTextColor="#728198"
              multiline
              maxLength={16000}
              value={draft}
              onChangeText={setDraft}
              editable={!demo}
            />
            <Button
              label={session?.running ? '停止' : '发送'}
              disabled={
                !ready ||
                demo ||
                busy ||
                !session ||
                (!session.running && !draft.trim())
              }
              onPress={() =>
                session?.running
                  ? api && guard(api.cancel(session.id))
                  : send()
              }
            />
          </View>
          {demo && (
            <Button
              label="返回运行环境"
              onPress={() => {
                setDemo(false);
                setSession(null);
                setTab('environment');
              }}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Mobile />
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1017' },
  header: { padding: 22 },
  eyebrow: {
    color: '#7bd6b4',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: { color: '#f4f6f8', fontSize: 25, fontWeight: '700' },
  notice: { color: '#8fa69f', fontSize: 12, padding: 14 },
  error: {
    color: '#ffbb9d',
    backgroundColor: '#34251f',
    padding: 12,
    margin: 10,
    borderRadius: 8,
  },
  content: { padding: 20, paddingTop: 0, paddingBottom: 40, gap: 10 },
  section: { fontSize: 16, fontWeight: '600', color: '#e3e9ec', marginTop: 20 },
  card: { padding: 16, borderRadius: 14, backgroundColor: '#141e2a', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#e8eef2' },
  muted: { fontSize: 12, lineHeight: 20, color: '#91a0b2' },
  code: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#b3d4cc',
    lineHeight: 18,
  },
  input: {
    color: '#e8eef2',
    backgroundColor: '#182330',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
  },
  button: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: '#234d40',
    alignItems: 'center',
    margin: 3,
  },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#edf6f2', fontWeight: '600', fontSize: 12 },
  footnote: { fontSize: 11, lineHeight: 20, color: '#687b91', marginTop: 16 },
  chat: { flex: 1 },
  strip: { maxHeight: 54 },
  heading: { padding: 18, gap: 5 },
  messages: { paddingHorizontal: 16, paddingBottom: 20, gap: 12 },
  bubble: { backgroundColor: '#141e2a', padding: 15, borderRadius: 14 },
  userBubble: { backgroundColor: '#1b332d', marginLeft: 30 },
  role: { fontSize: 10, color: '#79b7a4', letterSpacing: 1, marginBottom: 9 },
  message: { fontSize: 14, lineHeight: 23, color: '#e3e9ef' },
  permission: {
    margin: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#b78f44',
    borderRadius: 12,
    gap: 8,
  },
  permissionInput: { maxHeight: 100 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 10,
    backgroundColor: '#101923',
  },
  draft: {
    flex: 1,
    maxHeight: 130,
    minHeight: 42,
    color: '#e8eef2',
    padding: 10,
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
});
