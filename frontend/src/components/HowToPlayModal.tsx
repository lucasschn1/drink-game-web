import { useEffect } from "react";
import "./HowToPlayModal.css";

interface HowToPlayModalProps {
  onClose: () => void;
}

export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
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
        aria-labelledby="how-to-play-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="how-to-play-title">Como jogar</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <ol className="modal-steps">
          <li>Uma pessoa cria a partida e cadastra o nome de todo mundo, na ordem que quiser.</li>
          <li>O celular passa de mão em mão, seguindo a ordem cadastrada.</li>
          <li>Na sua vez, você toca na carta virada pra baixo pra revelar.</li>
          <li>A regra da carta aparece — todo mundo cumpre, aí passa o celular pro próximo.</li>
          <li>
            Se sair um <strong>K</strong>, quem tirou cria uma regra nova que vale pra rodada
            inteira.
          </li>
        </ol>
        <button type="button" className="modal-cta" onClick={onClose}>
          Entendi
        </button>
      </div>
    </div>
  );
}
