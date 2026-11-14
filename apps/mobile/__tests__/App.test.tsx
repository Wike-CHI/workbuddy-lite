import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState} from 'react-native';
import type {AppStateStatus} from 'react-native';
import App from '../App';

const defaults = {installed: true, permission: true, repo: '/data/data/com.termux/files/home/workbuddy-lite', version: '1.2.3'};
const mockStatus = jest.fn(async () => ({...defaults}));
const mockLaunch = jest.fn<Promise<{launched: boolean}>, unknown[]>(async () => ({launched: true}));
jest.mock('../src/native', () => ({termux: {
  status: () => mockStatus(), pairing: jest.fn(async () => null), saveSettings: jest.fn(async () => {}),
  launch: (...args: unknown[]) => mockLaunch(...args), openSettings: jest.fn(async () => {}), openTermux: jest.fn(async () => {}),
}}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaProvider: ({children}: any) => children, SafeAreaView: ({children}: any) => children}));
beforeEach(() => {
  mockStatus.mockReset().mockResolvedValue({...defaults});
  mockLaunch.mockReset().mockResolvedValue({launched: true});
});
afterEach(() => jest.restoreAllMocks());

test('main setup text contains a copyable command, not a branch detection result', async () => {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<App />); });
  const text = renderer!.root.findAllByProps({testID: 'repository-setup'})[0].props.children;
  expect(text).toBe('pkg install git nodejs-lts\ngit clone --branch main https://github.com/Wike-CHI/workbuddy-lite.git');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('feat/android');
  expect(JSON.stringify(renderer!.toJSON())).toContain('v');
  await act(async () => { renderer!.unmount(); });
});

test('returning from Android settings refreshes permission without discarding edited fields', async () => {
  mockStatus.mockResolvedValueOnce({...defaults, permission: false});
  let listener: (state: AppStateStatus) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    listener = callback; return {remove: jest.fn()};
  });
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<App />); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('尚未授予');
  await act(async () => {
    renderer!.root.findAllByProps({accessibilityLabel: '仓库路径'})[0].props.onChangeText(`${defaults.repo}-custom`);
    renderer!.root.findAllByProps({accessibilityLabel: 'CLI 版本'})[0].props.onChangeText('2.3.4');
    listener('background');
  });
  await act(async () => { listener('active'); });
  expect(mockStatus).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(renderer!.toJSON())).toContain('命令权限已授予');
  expect(renderer!.root.findAllByProps({accessibilityLabel: '仓库路径'})[0].props.value).toBe(`${defaults.repo}-custom`);
  expect(renderer!.root.findAllByProps({accessibilityLabel: 'CLI 版本'})[0].props.value).toBe('2.3.4');
  await act(async () => { renderer!.unmount(); });
});

test('native permission errors explain the actual blocker', async () => {
  mockLaunch.mockRejectedValueOnce(Object.assign(new Error('native message'), {code: 'PERMISSION_REQUIRED'}));
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<App />); });
  await act(async () => { renderer!.root.findAllByProps({testID: '登录账户'})[0].props.onPress(); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('尚未取得系统的 Termux 命令权限');
  await act(async () => { renderer!.unmount(); });
});

test('environment opens terminal login and demo never runs a task', async () => {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<App />); });
  const button = (label: string) => renderer!.root.findAllByProps({testID: label})[0];
  await act(async () => { button('登录账户')!.props.onPress(); });
  expect(mockLaunch).toHaveBeenCalledWith('login', defaults.repo, '1.2.3');
  mockLaunch.mockClear();
  await act(async () => { button('查看界面演示')!.props.onPress(); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('演示模式');
  expect(mockLaunch).not.toHaveBeenCalled();
  await act(async () => { renderer!.unmount(); });
});

test('early foreground refresh restores saved settings and ignores older permission results', async () => {
  let resolveOld: (value: typeof defaults) => void = () => {};
  mockStatus.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  mockStatus.mockResolvedValue({...defaults, repo: `${defaults.repo}-saved`, version: '3.4.5'});
  let listener: (state: AppStateStatus) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    listener = callback; return {remove: jest.fn()};
  });
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<App />); });
  await act(async () => { listener('active'); });
  expect(renderer!.root.findAllByProps({accessibilityLabel: '仓库路径'})[0].props.value).toBe(`${defaults.repo}-saved`);
  await act(async () => { resolveOld({...defaults, permission: false}); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('命令权限已授予');
  expect(renderer!.root.findAllByProps({accessibilityLabel: 'CLI 版本'})[0].props.value).toBe('3.4.5');
  await act(async () => { renderer!.unmount(); });
});
