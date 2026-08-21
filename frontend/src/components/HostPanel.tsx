import { useEffect, useState } from "react";
import type { Player } from "../api/types";
import "./HowToPlayModal.css";
import "./HostPanel.css";

interface HostPanelProps {
  players: Player[];
  onClose: () => void;
  onKick: (playerId: number) => void;
  onEndMatch: () => void;
  loading: boolean;
}

export function HostPanel({ players, onClose, onKick, onEndMatch, loading }: HostPanelProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="host-panel-title">Gerenciar partida</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <ul className="host-player-list">
          {players.map((p) => (
            <li key={p.id} className="host-player-row">
              <span>{p.name}</span>
              <button type="button" disabled={loading} onClick={() => onKick(p.id)}>
                Remover
              </button>
            </li>
          ))}
        </ul>

        {confirmingEnd ? (
          <div className="host-end-confirm">
            <p>Encerrar a partida agora, pra todo mundo?</p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => setConfirmingEnd(false)}>
                Cancelar
              </button>
              <button type="button" className="danger" disabled={loading} onClick={onEndMatch}>
                {loading ? "Encerrando…" : "Encerrar"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirmingEnd(true)}>
            Encerrar partida
          </button>
        )}
      </div>
    </div>
  );
}
