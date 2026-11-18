-- P1: to nye casestadier til finans-først-
-- fonde og family offices: 'growth' (Vækst, omkring break-even) og 'buyout'
-- (Buyout / generationsskifte). En fond slår dem fra ved ikke at have dem i sin
-- stadieliste; så vises de ikke ved oprettelse af cases.
--
-- Kun nye enum-værdier; ingen data, rettigheder eller RLS ændres. Værdierne bruges
-- ikke i samme transaktion (krav for ALTER TYPE ... ADD VALUE i en transaktion).
begin;

alter type public.company_stage add value if not exists 'growth' after 'later';
alter type public.company_stage add value if not exists 'buyout' after 'growth';

commit;
