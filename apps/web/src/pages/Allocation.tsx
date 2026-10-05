import { Plus, Target, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Donut } from "../components/charts.js";
import { useConfirm } from "../components/dialog.js";
import { Button, Empty, IconButton, MiniStat, Panel, SectionHeading } from "../components/ui.js";
import { api } from "../lib/api.js";
import { categoryLabel, money, percent } from "../lib/format.js";
import { useToast } from "../lib/toast.js";
import type { AllocationTarget, Dashboard } from "../lib/types.js";

const aliasToCategory: Record<string, string> = {
  dolar: "dollar",
  caixa_br: "cash",
  bolsa_brasil: "b3",
  renda_fixa: "fixed_income",
  acoes_globais: "global"
};

// Nomes das classes padrão na Alocação; as customizadas trazem o próprio nome.
const defaultLabels: Record<string, string> = {
  bitcoin: "Bitcoin",
  shitcoins: "Altcoins",
  acoes_globais: "Ações Globais",
  bolsa_brasil: "Ações Brasileiras",
  caixa_br: "Caixa (BRL)",
  dolar: "Caixa (USD)",
  renda_fixa: "Renda Fixa"
};

const targetLabel = (target: AllocationTarget) =>
  target.label ?? defaultLabels[target.category] ?? categoryLabel(target.category);

function actualValue(category: string, dashboard: Dashboard) {
  if (category === "bitcoin") {
    return dashboard.portfolios.crypto.find((asset) => asset.asset === "BTC")?.marketValueBrl ?? 0;
  }
  if (category === "shitcoins") {
    return dashboard.portfolios.crypto
      .filter((asset) => asset.asset !== "BTC")
      .reduce((sum, asset) => sum + asset.marketValueBrl, 0);
  }
  return dashboard.categories[aliasToCategory[category] ?? category] ?? 0;
}

const oneDecimal = (weight: number) => `${(weight * 100).toFixed(1).replace(".", ",")}%`;
// Meta em % com até uma casa ("25", "2,5"), para o campo de digitação.
const percentText = (weight: number) => String(Math.round(weight * 1000) / 10).replace(".", ",");

export function AllocationPage({ dashboard }: { dashboard: Dashboard }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [targets, setTargets] = useState<AllocationTarget[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api<AllocationTarget[]>("/allocation").then(setTargets), []);
  useEffect(() => void load(), [load]);

  const investable = dashboard.totalBrl - dashboard.reserveBrl;

  // Ordenado pelo valor atual (estável durante o arraste do slider).
  const rows = useMemo(
    () =>
      targets
        .map((target) => {
          const actual = actualValue(target.category, dashboard);
          return {
            ...target,
            name: targetLabel(target),
            actual,
            actualWeight: investable > 0 ? actual / investable : 0
          };
        })
        .sort((a, b) => b.actual - a.actual),
    [targets, dashboard, investable]
  );

  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
  const weightOff = Math.abs(totalWeight - 1) > 0.0005;

  // Donut da meta que está sendo montada — redesenha ao vivo conforme os sliders.
  const targetSlices = useMemo(
    () =>
      rows
        .filter((row) => row.weight > 0)
        .map((row) => ({ key: row.category, label: row.name, value: row.weight })),
    [rows]
  );

  function setWeight(category: string, weight: number) {
    setTargets((current) =>
      current.map((target) => (target.category === category ? { ...target, weight } : target))
    );
  }

  async function commit(category: string, weight: number) {
    try {
      await api(`/allocation/${category}`, { method: "PUT", body: JSON.stringify({ weight }) });
      toast.notify("Meta atualizada");
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar a meta", "error");
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      const created = await api<AllocationTarget>("/allocation/categories", {
        method: "POST",
        body: JSON.stringify({ label: newLabel })
      });
      setTargets((current) => [...current, created]);
      setNewLabel("");
      toast.notify(`Categoria "${created.label}" criada; cadastre as posições em Posições`);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao criar a categoria", "error");
    } finally {
      setAdding(false);
    }
  }

  async function removeCategory(target: AllocationTarget) {
    const ok = await confirm({
      title: "Excluir categoria",
      message: `Remover "${targetLabel(target)}" e a meta dela?`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    try {
      await api(`/allocation/${target.category}`, { method: "DELETE" });
      setTargets((current) => current.filter((item) => item.category !== target.category));
      toast.notify("Categoria excluída");
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao excluir a categoria", "error");
    }
  }

  return (
    <div className="allocation">
      <SectionHeading
        title="Alocação ideal"
        subtitle="Compara a estratégia com a carteira atual (reserva excluída)"
      />

      <div className="summary-row">
        <MiniStat label="Total investível" value={money(investable)} />
        <MiniStat label="Reserva (fora da meta)" value={money(dashboard.reserveBrl)} />
        <MiniStat
          label={weightOff ? "Soma das metas · ajuste p/ 100%" : "Soma das metas"}
          value={oneDecimal(totalWeight)}
          tone={weightOff ? "negative-text" : "positive-text"}
        />
      </div>

      <Panel title="Real x ideal" subtitle="Arraste o marcador ou digite a meta de cada classe">
        <div className="allocation-split">
          <div className="allocation-list">
            {rows.map((row) => (
              <div className="allocation-row" key={row.category}>
                <div className="allocation-name">
                  <strong>{row.name}</strong>
                  <span>
                    {money(row.actual)} · {percent(row.actualWeight)} atual
                  </span>
                </div>
                <div className="alloc-slider">
                  <div className="allocation-track">
                    <div
                      className="allocation-fill"
                      style={{ width: `${Math.min(100, row.actualWeight * 100)}%` }}
                    />
                  </div>
                  <input
                    className="alloc-range"
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={+(row.weight * 100).toFixed(1)}
                    aria-label={`Meta de ${row.name}`}
                    onChange={(event) => setWeight(row.category, Number(event.target.value) / 100)}
                    onPointerUp={(event) =>
                      void commit(row.category, Number((event.target as HTMLInputElement).value) / 100)
                    }
                    onKeyUp={(event) =>
                      void commit(row.category, Number((event.target as HTMLInputElement).value) / 100)
                    }
                  />
                </div>
                <TargetInput
                  label={row.name}
                  weight={row.weight}
                  onChange={(weight) => setWeight(row.category, weight)}
                  onCommit={(weight) => void commit(row.category, weight)}
                />
                {row.custom ? (
                  <IconButton
                    icon={Trash2}
                    label={`Excluir ${row.name}`}
                    tone="danger"
                    onClick={() => void removeCategory(row)}
                  />
                ) : (
                  <span aria-hidden />
                )}
              </div>
            ))}
            {!rows.length && <Empty icon={Target} text="Nenhuma meta de alocação definida." />}
            <form className="alloc-add" onSubmit={addCategory}>
              <input
                value={newLabel}
                maxLength={40}
                placeholder="Nova categoria (ex.: Imóveis)"
                aria-label="Nome da nova categoria"
                onChange={(event) => setNewLabel(event.target.value)}
              />
              <Button type="submit" variant="ghost" icon={Plus} disabled={adding || !newLabel.trim()}>
                Adicionar
              </Button>
            </form>
          </div>
          {rows.length > 0 && (
            <aside className="allocation-chart">
              <span className="allocation-chart-label">Meta em construção</span>
              <Donut data={targetSlices} height={340} />
            </aside>
          )}
        </div>
      </Panel>
    </div>
  );
}

/**
 * Meta digitada em %. Acompanha o slider enquanto não está em edição; ao digitar, o slider
 * e o donut acompanham. Salva ao sair do campo ou com Enter, só se o valor mudou; Esc desfaz.
 */
function TargetInput({
  label,
  weight,
  onChange,
  onCommit
}: {
  label: string;
  weight: number;
  onChange: (weight: number) => void;
  onCommit: (weight: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const weightAtFocus = useRef(weight);
  const cancelled = useRef(false);
  const selectingOnClick = useRef(false);

  function parse(text: string) {
    if (!text.trim()) return null;
    const value = Number(text.replace(",", "."));
    return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value)) * 10) / 1000 : null;
  }

  return (
    <div className="alloc-input">
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? percentText(weight)}
        aria-label={`Meta de ${label} em %`}
        // O foco só seleciona o texto (digitar substitui a meta). Não mexe no valor: regravar o
        // texto aqui desfaria a seleção e o que fosse digitado iria para o fim do valor antigo.
        onFocus={(event) => {
          weightAtFocus.current = weight;
          selectingOnClick.current = true;
          event.target.select();
        }}
        onMouseUp={(event) => {
          // no Chrome o mouseup do clique que deu foco desfaz a seleção feita no onFocus
          if (selectingOnClick.current) event.preventDefault();
          selectingOnClick.current = false;
        }}
        onChange={(event) => {
          selectingOnClick.current = false;
          setDraft(event.target.value);
          const next = parse(event.target.value);
          if (next !== null) onChange(next);
        }}
        onBlur={() => {
          const next = draft === null || cancelled.current ? null : parse(draft);
          cancelled.current = false;
          selectingOnClick.current = false;
          setDraft(null);
          if (next === null) onChange(weightAtFocus.current);
          else if (next !== weightAtFocus.current) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
      <span>%</span>
    </div>
  );
}
