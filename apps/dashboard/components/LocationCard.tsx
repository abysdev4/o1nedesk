"use client";

import { useEffect, useState } from "react";
import { useHub } from "./HubProvider";
import { MapPin, LocateFixed, ExternalLink, Loader2 } from "lucide-react";
import { timeAgo } from "@/lib/format";

type Loc = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  source?: string;
  city?: string | null;
  at?: string;
};

export default function LocationCard({ machine, online }: { machine: any; online: boolean }) {
  const hub = useHub();
  const [loc, setLoc] = useState<Loc | null>(machine.lastLocation || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const off = hub.on("location:report", (m: any) => {
      if (m.agentId === machine.agentId) {
        setLoc(m.location);
        setLoading(false);
      }
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function request() {
    setLoading(true);
    hub.send({ type: "location:request", agentId: machine.agentId });
    setTimeout(() => setLoading(false), 20000);
  }

  const d = 0.015;
  const bbox = loc ? `${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}` : "";
  const sourceLabel =
    loc?.source === "windows" ? "GPS/WiFi (preciso)" : loc?.source === "ip" ? "por IP (aproximado)" : "—";

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted flex items-center gap-2">
          <MapPin size={15} /> Localização do dispositivo
        </h3>
        <button onClick={request} disabled={!online || loading} className="btn-ghost disabled:opacity-40">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} />}
          {loading ? "Aguardando..." : "Pedir localização"}
        </button>
      </div>

      {!loc ? (
        <p className="text-sm text-muted">
          {online
            ? "Nenhuma localização ainda. Clique em “Pedir localização” para um pulso."
            : "Máquina offline — mostrando a última localização conhecida (nenhuma registrada)."}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg overflow-hidden border border-border h-56">
            <iframe
              title="mapa"
              className="w-full h-full"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row k="Coordenadas" v={`${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`} />
            <Row k="Fonte" v={sourceLabel} />
            {loc.city && <Row k="Local" v={loc.city} />}
            {loc.accuracy != null && <Row k="Precisão" v={`~${Math.round(loc.accuracy)} m`} />}
            {loc.at && <Row k="Atualizado" v={timeAgo(loc.at)} />}
          </div>
          <a
            href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost inline-flex w-fit"
          >
            <ExternalLink size={14} /> Abrir no Google Maps
          </a>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 pb-1.5">
      <span className="text-muted">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
