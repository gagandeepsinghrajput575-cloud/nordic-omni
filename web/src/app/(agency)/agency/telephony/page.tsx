import { TelephonyHub } from "@/components/agency/TelephonyHub";
import {
getAgencyWorkspace,
getSipSessions,
getTelephonyHealth,
getTelephonyNumbers,
listClientWorkspaces,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata = {
title: "Telephony & DIDs",
};

export default async function TelephonyPage() {
const agency = await getAgencyWorkspace();
const [numbers, sessions, health, clients] = await Promise.all([
getTelephonyNumbers(agency.id),
getSipSessions(agency.id, 12),
getTelephonyHealth(agency.id),
listClientWorkspaces(agency.id),
]);

return (
<TelephonyHub
agencyName={agency.name}
initialNumbers={numbers}
initialSessions={sessions}
initialHealth={health}
clients={clients.map((client) => ({
id: client.id,
name: client.name,
slug: client.slug,
agentName: client.agentName,
}))}
/>
);
}
