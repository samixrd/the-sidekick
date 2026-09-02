import { AgentDetailPage } from "@/components/agent-detail/agent-detail-page";

export default function AgentDetail({ params }: { params: { wallet: string } }) {
  return <AgentDetailPage wallet={params.wallet} />;
}
