import { NativeModules } from 'react-native';
export interface Pairing {
  port: number;
  token: string;
  instance: string;
}
export interface Environment {
  installed: boolean;
  permission: boolean;
  repo: string;
  version: string;
}
interface Launcher {
  status(): Promise<Environment>;
  saveSettings(repo: string, version: string): Promise<void>;
  pairing(): Promise<Pairing | null>;
  openSettings(): Promise<void>;
  openTermux(): Promise<void>;
  launch(
    action: string,
    repo: string,
    version: string,
  ): Promise<{ ok?: boolean; launched?: boolean; report?: string }>;
}
export const termux: Launcher = NativeModules.TermuxLauncher;
