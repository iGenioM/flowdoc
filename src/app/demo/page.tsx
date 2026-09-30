import { FlowCanvas } from "@/components/flow/flow-canvas";
import { orderExpired } from "@/fixtures/order-expired";

// M1: fluxo fixo de exemplo. Home/projetos chegam no M2.
export default function Page() {
  return (
    <main className="h-screen w-screen">
      <FlowCanvas doc={orderExpired} />
    </main>
  );
}
