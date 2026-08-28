'use client';

import { useParams } from 'next/navigation';
import { TicketDetailView } from '@/components/support/ticket-detail';

export default function PlatformTicketPage() {
  const params = useParams<{ id: string }>();
  return <TicketDetailView scope="platform" id={params.id} />;
}
