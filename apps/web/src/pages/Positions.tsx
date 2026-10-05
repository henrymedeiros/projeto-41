import { Banknote, Coins, DollarSign, Landmark, PiggyBank, Plus, Save, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Drawer, useConfirm } from "../components/dialog.js";
import { AssetIcon, Button, Card, Field, IconButton, MiniStat, NumberInput, SectionHeading, Segmented } from "../components/ui.js";
import { api } from "../lib/api.js";
import { currency as fmtCurrency, money, percent, privateText, valuesMasked } from "../lib/format.js";
import { institutionIconUrl } from "../lib/icons.js";
import { useToast } from "../lib/toast.js";
import type { AllocationTarget, ManualPosition, MonthlyIncome } from "../lib/types.js";

type Group = { id: string; label: string; icon: typeof Banknote; hint: string; tracksInvested: boolean };
type YieldType = ManualPosition["yieldType"];

const builtInGroups: Group[] = [
  { id: "dollar", label: "Dólar (USD)", icon: DollarSign, hint: "Contas e carteiras em dólar", tracksInvested: false },
  { id: "cash", label: "Real (BRL)", icon: Banknote, hint: "Saldo disponível em reais", tracksInvested: false },
  { id: "reserve", label: "Reserva de Emergência", icon: PiggyBank, hint: "Liquidez para imprevistos", tracksInvested: false },
  { id: "fixed_income", label: "Renda Fixa", icon: Landmark, hint: "Tesouro e títulos", tracksInvested: true },
  { id: "global", label: "Ações globais", icon: Coins, hint: "Exposição internacional", tracksInvested: true }
];

const tracksInvested = (groups: Group[], category: string) =>
  groups.find((group) => group.id === category)?.tracksInvested ?? false;

// Mesmo padrão do backend (defaultPositionYield): 100% do CDI só em Real e Reserva.
const defaultYield = (category: string): { yieldType: YieldType; yieldRate: number } =>
  category === "cash" || category === "reserve" ? { yieldType: "cdi", yieldRate: 1 } : { yieldType: "none", yieldRate: 0 };

const defaultCurrency = (category: string): "BRL" | "USD" => (category === "dollar" ? "USD" : "BRL");

const rateNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

// Sugestões do campo Instituição (além das que você já usou); dá para digitar qualquer outra.
const commonInstitutions = [
  "Nubank", "Inter", "Itaú", "Bradesco", "Banco do Brasil", "Caixa", "Santander", "C6 Bank",
  "BTG Pactual", "XP", "Rico", "Clear", "PicPay", "Mercado Pago", "PagBank",
  "Wise", "Nomad", "Avenue", "Binance"
];

/** Título da posição: o nome, ou a instituição quando ela não tem nome. */
const positionTitle = (position: Pick<ManualPosition, "name" | "institution">) =>
  position.name || position.institution || "";

/** Como a lista mostra a posição; no modo privacidade a instituição (e o logo dela) some. */
function shownPosition(position: ManualPosition) {
  const institution = position.institution ? privateText(position.institution) : "";
  const hideLogo = valuesMasked() && Boolean(position.institution);
  return {
    title: position.name || institution,
    // sem nome, a instituição já é o título
    institutionDetail: position.name ? institution : "",
    iconSrc: hideLogo ? undefined : institutionIconUrl(position.institution || position.name),
    iconLabel: hideLogo ? institution : position.institution || position.name
  };
}

/** "100% CDI", "12% a.a." ou "" quando a posição não rende. */
function yieldLabel(position: Pick<ManualPosition, "yieldType" | "yieldRate">) {
  if (position.yieldType === "cdi") return `${rateNumber.format(position.yieldRate * 100)}% CDI`;
  if (position.yieldType === "fixed") return `${rateNumber.format(position.yieldRate * 100)}% a.a.`;
  return "";
}

export function PositionsPage({
  income,
  usdBrl,
  onChanged
}: {
  income?: MonthlyIncome;
  usdBrl: number;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [positions, setPositions] = useState<ManualPosition[]>([]);
  const [editing, setEditing] = useState<Partial<ManualPosition> | null>(null);
  const [customCategories, setCustomCategories] = useState<AllocationTarget[]>([]);

  const load = useCallback(() => api<ManualPosition[]>("/positions").then(setPositions), []);
  useEffect(() => void load(), [load]);
  // Categorias criadas na Alocação viram grupos aqui, depois das padrão.
  useEffect(() => {
    void api<AllocationTarget[]>("/allocation").then((targets) =>
      setCustomCategories(targets.filter((target) => target.custom))
    );
  }, []);
  const groups = useMemo<Group[]>(
    () => [
      ...builtInGroups,
      ...customCategories.map((target) => ({
        id: target.category,
        label: target.label ?? target.category,
        icon: Tag,
        hint: "Categoria personalizada",
        tracksInvested: true
      }))
    ],
    [customCategories]
  );
  const institutions = useMemo(
    () =>
      [...new Set([...positions.map((position) => position.institution ?? ""), ...commonInstitutions])]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [positions]
  );
  const monthlyById = useMemo(
    () => new Map((income?.items ?? []).map((item) => [item.id, item.monthlyBrl])),
    [income]
  );

  // tudo em reais (dólar pela cotação do dia), para somar seções e comparar
  const toBrl = (position: ManualPosition) => position.currentValue * (position.currency === "USD" ? usdBrl : 1);
  const totalBrl = positions.reduce((sum, position) => sum + toBrl(position), 0);
  const openNew = (category: string) => setEditing({ category, currency: defaultCurrency(category) });

  async function remove(position: ManualPosition) {
    const ok = await confirm({
      title: "Excluir posição",
      message: `Remover "${positionTitle(position)}"?`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    await api(`/positions/${position.id}`, { method: "DELETE" });
    await Promise.all([load(), onChanged()]);
    toast.notify("Posição excluída");
  }

  return (
    <div className="positions">
      <SectionHeading title="Posições" subtitle="Contas e aplicações atualizadas por você">
        <Button icon={Plus} onClick={() => setEditing({})}>
          Nova posição
        </Button>
      </SectionHeading>

      {income?.cdiUnavailable && (
        <div className="inline-alert error" role="alert">
          Não foi possível recuperar os dados do CDI (Banco Central).{" "}
          {income.cdiAnnual !== null
            ? `A renda mensal está usando o último valor obtido: ${percent(income.cdiAnnual)} a.a.${
                income.cdiReference
                  ? ` (meta Selic vigente desde ${new Date(income.cdiReference).toLocaleDateString("pt-BR")})`
                  : ""
              }.`
            : "As posições em % do CDI ficam fora da renda mensal até o CDI voltar."}
        </div>
      )}

      <div className="summary-row stagger">
        <MiniStat label="Total em posições" value={money(totalBrl)} />
        <MiniStat label="Renda mensal (bruta)" value={money(income?.totalBrl ?? 0)} tone="positive-text" />
        <MiniStat label="Posições" value={String(positions.length)} />
      </div>

      <div className="position-groups stagger">
        {groups.map((group) => {
          const items = positions.filter((position) => position.category === group.id);
          if (!items.length && group.id === "global") return null;
          const subtotalBrl = items.reduce((sum, item) => sum + toBrl(item), 0);
          const usdItems = items.filter((item) => item.currency === "USD");
          const subtotalUsd = usdItems.reduce((sum, item) => sum + item.currentValue, 0);
          const groupIncome = items.reduce((sum, item) => sum + (monthlyById.get(item.id) ?? 0), 0);
          const Icon = group.icon;
          return (
            <Card key={group.id} className="position-card">
              <div className="position-card-head">
                <div className="position-group-icon">
                  <Icon size={18} />
                </div>
                <div>
                  <h3>{group.label}</h3>
                  <p>{group.hint}</p>
                </div>
                <div className="position-head-values">
                  <strong className="position-subtotal">{money(subtotalBrl)}</strong>
                  {usdItems.length > 0 && <small className="usd-subtotal">{fmtCurrency(subtotalUsd, "USD")}</small>}
                  {groupIncome > 0 && <small className="positive-text">+{money(groupIncome)}/mês</small>}
                </div>
                {/* vazia, a seção já tem o botão "Adicionar posição" no corpo */}
                {items.length > 0 && (
                  <IconButton
                    icon={Plus}
                    label={`Nova posição em ${group.label}`}
                    onClick={() => openNew(group.id)}
                  />
                )}
              </div>
              <div className="position-items">
                {items.map((position) => {
                  const change =
                    position.invested > 0 ? position.currentValue / position.invested - 1 : 0;
                  const monthly = monthlyById.get(position.id) ?? 0;
                  const shown = shownPosition(position);
                  const details = [
                    shown.institutionDetail,
                    position.currency,
                    yieldLabel(position),
                    monthly > 0 ? `${money(monthly)}/mês` : ""
                  ].filter(Boolean);
                  return (
                    <button key={position.id} className="position-item" onClick={() => setEditing(position)}>
                      <div className="position-item-main">
                        <AssetIcon src={shown.iconSrc} label={shown.iconLabel} />
                        <div className="position-item-name">
                          <strong>{shown.title}</strong>
                          <small>{details.join(" · ")}</small>
                        </div>
                      </div>
                      <div className="position-item-values">
                        <strong>{fmtCurrency(position.currentValue, position.currency)}</strong>
                        {position.invested > 0 && Math.abs(change) > 1e-9 && (
                          <small className={change >= 0 ? "positive-text" : "negative-text"}>
                            {change >= 0 ? "+" : ""}
                            {percent(change)}
                          </small>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!items.length && (
                  <div className="position-empty">
                    <span>Nenhuma posição em {group.label}.</span>
                    <Button variant="ghost" icon={Plus} onClick={() => openNew(group.id)}>
                      Adicionar posição
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {editing && (
        <PositionDrawer
          groups={groups}
          institutions={institutions}
          initial={editing}
          cdiAnnual={income?.cdiAnnual ?? null}
          usdBrl={usdBrl}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => remove(editing as ManualPosition) : undefined}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([load(), onChanged()]);
            toast.notify("Posição salva");
          }}
        />
      )}
    </div>
  );
}

// Mesma conta de packages/finance (effectiveAnnualYield + monthlyIncome), só para a prévia
// do painel: no CDI o percentual incide sobre a taxa diária (252 dias úteis).
function estimateMonthly(valueBrl: number, type: YieldType, rate: number, cdiAnnual: number | null) {
  if (!(valueBrl > 0) || !(rate > 0) || type === "none") return 0;
  let annual = rate;
  if (type === "cdi") {
    if (cdiAnnual === null) return null;
    annual = (1 + ((1 + cdiAnnual) ** (1 / 252) - 1) * rate) ** 252 - 1;
  }
  return valueBrl * ((1 + annual) ** (1 / 12) - 1);
}

const toNumber = (text: string) => Number(text.replace(",", "."));

function PositionDrawer({
  groups,
  institutions,
  initial,
  cdiAnnual,
  usdBrl,
  onClose,
  onSaved,
  onDelete
}: {
  groups: Group[];
  institutions: string[];
  initial: Partial<ManualPosition>;
  cdiAnnual: number | null;
  usdBrl: number;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const isNew = !initial.id;
  const initialCategory = initial.category ?? "cash";
  const initialYield = initial.yieldType
    ? { yieldType: initial.yieldType, yieldRate: initial.yieldRate ?? 0 }
    : defaultYield(initialCategory);
  const [category, setCategory] = useState(initialCategory);
  const [currencyCode, setCurrencyCode] = useState<"BRL" | "USD">(initial.currency ?? defaultCurrency(initialCategory));
  const [name, setName] = useState(initial.name ?? "");
  const [institution, setInstitution] = useState(initial.institution ?? "");
  // numa posição nova os valores começam vazios: não é preciso apagar um "0" antes de digitar
  const [invested, setInvested] = useState(initial.invested ? String(initial.invested) : "");
  const [currentValue, setCurrentValue] = useState(initial.currentValue ? String(initial.currentValue) : "");
  const [yieldType, setYieldType] = useState<YieldType>(initialYield.yieldType);
  // a taxa é digitada em % (100 = 100% do CDI, 12 = 12% a.a.) e gravada como fração
  const [yieldPercent, setYieldPercent] = useState(
    initialYield.yieldType === "none" ? "" : String(Math.round(initialYield.yieldRate * 10000) / 100)
  );
  const [touched, setTouched] = useState({ currency: false, yield: false });
  const [saving, setSaving] = useState(false);

  const showInvested = tracksInvested(groups, category);
  const symbol = currencyCode === "USD" ? "US$" : "R$";
  const valueBrl = (toNumber(currentValue) || 0) * (currencyCode === "USD" ? usdBrl : 1);
  const monthly = estimateMonthly(valueBrl, yieldType, toNumber(yieldPercent) / 100, cdiAnnual);

  // Numa posição nova, trocar a categoria aplica a moeda e o rendimento padrão dela,
  // enquanto o usuário não tiver escolhido esses campos.
  function changeCategory(next: string) {
    setCategory(next);
    if (!isNew) return;
    if (!touched.currency) setCurrencyCode(defaultCurrency(next));
    if (!touched.yield) {
      const preset = defaultYield(next);
      setYieldType(preset.yieldType);
      setYieldPercent(preset.yieldType === "none" ? "" : String(preset.yieldRate * 100));
    }
  }

  function changeCurrency(next: "BRL" | "USD") {
    setTouched((current) => ({ ...current, currency: true }));
    setCurrencyCode(next);
  }

  function changeYieldType(next: YieldType) {
    setTouched((current) => ({ ...current, yield: true }));
    setYieldType(next);
    if (next === "cdi") setYieldPercent("100");
    if (next === "fixed") setYieldPercent("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() && !institution.trim()) {
      toast.notify("Informe a instituição ou o nome da posição", "error");
      return;
    }
    const rate = yieldType === "none" ? 0 : toNumber(yieldPercent) / 100;
    if (yieldType !== "none" && !(rate > 0)) {
      toast.notify(yieldType === "cdi" ? "Informe o % do CDI" : "Informe a taxa ao ano", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category,
        name: name.trim(),
        institution: institution.trim() || undefined,
        invested: showInvested ? toNumber(invested) || 0 : 0,
        currentValue: toNumber(currentValue) || 0,
        currency: currencyCode,
        notes: initial.notes ?? "",
        yieldType,
        yieldRate: rate
      };
      await api(initial.id ? `/positions/${initial.id}` : "/positions", {
        method: initial.id ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar a posição", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={isNew ? "Nova posição" : "Editar posição"}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" icon={Trash2} onClick={onDelete} className="footer-left">
              Excluir
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="position-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar posição"}
          </Button>
        </>
      }
    >
      <form id="position-form" className="stack position-form" onSubmit={submit}>
        <Field label="Categoria">
          <select value={category} onChange={(event) => changeCategory(event.target.value)}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="position-form-group">
          <Field label="Instituição">
            <input
              value={institution}
              maxLength={60}
              list="position-institutions"
              autoFocus
              placeholder="Ex.: Nubank, XP, Wise"
              onChange={(event) => setInstitution(event.target.value)}
            />
            <datalist id="position-institutions">
              {institutions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <Field label="Nome" hint="Preencha a instituição, o nome ou os dois.">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Caixinha, Reserva" />
          </Field>
        </div>

        <div className="position-form-group">
          <div className="field">
            <div className="field-head">
              <label className="field-label" htmlFor="position-current-value">
                Valor atual
              </label>
              <div className="eq-currency position-currency" role="group" aria-label="Moeda da posição">
                {(["BRL", "USD"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={currencyCode === code ? "active" : ""}
                    aria-pressed={currencyCode === code}
                    onClick={() => changeCurrency(code)}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>
            <div className="input-suffix money-input">
              <span>{symbol}</span>
              <NumberInput
                id="position-current-value"
                value={currentValue}
                min="0"
                placeholder="0,00"
                onChange={(event) => setCurrentValue(event.target.value)}
              />
            </div>
          </div>
          {showInvested && (
            <Field label="Valor investido" hint="Quanto você aplicou, para ver o ganho da posição.">
              <div className="input-suffix money-input">
                <span>{symbol}</span>
                <NumberInput
                  value={invested}
                  min="0"
                  placeholder="0,00"
                  onChange={(event) => setInvested(event.target.value)}
                />
              </div>
            </Field>
          )}
        </div>

        <div className="position-form-group">
          <div className="field">
            <span className="field-label">Rendimento</span>
            <Segmented
              value={yieldType}
              onChange={changeYieldType}
              options={[
                { value: "cdi", label: "% do CDI" },
                { value: "fixed", label: "Prefixado" },
                { value: "none", label: "Sem rendimento" }
              ]}
            />
          </div>
          {yieldType !== "none" && (
            <Field label={yieldType === "cdi" ? "Percentual do CDI" : "Taxa ao ano"}>
              <div className="input-suffix">
                <NumberInput
                  value={yieldPercent}
                  min="0"
                  step="0.01"
                  placeholder={yieldType === "cdi" ? "100" : "12"}
                  onChange={(event) => {
                    setTouched((current) => ({ ...current, yield: true }));
                    setYieldPercent(event.target.value);
                  }}
                />
                <span>{yieldType === "cdi" ? "% do CDI" : "% ao ano"}</span>
              </div>
            </Field>
          )}
          {yieldType !== "none" && valueBrl > 0 && monthly !== 0 && (
            <p className="yield-preview">
              {monthly === null ? (
                "Sem o CDI no momento, não dá para estimar quanto rende."
              ) : (
                <>
                  Rende cerca de <strong>{money(monthly)} por mês</strong>
                  {yieldType === "cdi" && cdiAnnual !== null && <> com a meta Selic em {percent(cdiAnnual)} a.a.</>}
                </>
              )}
            </p>
          )}
        </div>
      </form>
    </Drawer>
  );
}
