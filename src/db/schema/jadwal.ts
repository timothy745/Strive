export interface Jadwal {
  id: number;
  user_id: number;
  day: string;
  exercise_name: string;
  reps: number;
  done: boolean;
  has_kg: boolean;
  kg?: number;
  sort_order: number;
}
