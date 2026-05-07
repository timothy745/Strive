export interface User {
  id: number;
  email: string;
  password?: string;
  nama?: string;
  dob?: string | Date;
  weight?: number;
  height?: number;
  profile_pic?: string;
  created_at?: string | Date;
}
