'use client';

import { useParams } from 'next/navigation';
import { TicketDetailView } from '@/components/support/ticket-detail';

export default function SchoolTicketPage() {
  const params = useParams<{ id: string }>();
  return <TicketDetailView scope="school" id={params.id} />;
}
