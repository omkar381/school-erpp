import { redirect } from 'next/navigation';

export default function RootPage() {
  // The shell decides whether this lands on the dashboard or bounces to login.
  redirect('/dashboard');
}
