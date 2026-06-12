export interface Progress {
  id: number;
  user_id: number;
  date: string | Date;
  duration_minutes?: number;
  calories_burned?: number;
  exercises_completed?: number;
}
