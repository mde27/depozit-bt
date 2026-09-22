export type Role = 'admin' | 'user1' | 'user2' | 'user3' | 'user4';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  company: string | null;
}

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export type ScanStage = 'SEND' | 'DELIVER' | 'RETURN_OUT' | 'RECEIVE_BACK';
