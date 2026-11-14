import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
const mockLaunch = jest.fn<Promise<{ launched: boolean }>, unknown[]>(async () => ({ launched: true }));
jest.mock('../src/native', () => ({
  termux: {
    status: jest.fn(async () => ({
      installed: true,
      permission: true,
      repo: '/data/data/com.termux/files/home/workbuddy-lite',
      version: '1.2.3',
    })),
    pairing: jest.fn(async () => null),
    saveSettings: jest.fn(async () => {}),
    launch: (...args: unknown[]) => mockLaunch(...args),
    openSettings: jest.fn(async () => {}),
    openTermux: jest.fn(async () => {}),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: ({ children }: any) => children,
}));

test('environment screen opens official terminal login and demo never runs a task', async () => {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<App />);
  });
  const button = (label: string) =>
    renderer!.root.findAllByProps({ testID: label })[0];
  await act(async () => {
    button('登录账户')!.props.onPress();
  });
  expect(mockLaunch).toHaveBeenCalledWith(
    'login',
    '/data/data/com.termux/files/home/workbuddy-lite',
    '1.2.3',
  );
  mockLaunch.mockClear();
  await act(async () => {
    button('查看界面演示')!.props.onPress();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('演示模式');
  expect(mockLaunch).not.toHaveBeenCalled();
  await act(async () => {
    renderer!.unmount();
  });
});
