-- SF-120 AI review test data (crm_dev, after the seed). Users: Ada=1, Grace=2. Prefix "Rv".
begin;
insert into pipelines (name, position) values ('RevPipe', 90), ('DelPipe', 91);
insert into stages (pipeline_id, name, position) select id, 'RA', 1 from pipelines where name='RevPipe';
insert into stages (pipeline_id, name, position) select id, 'RB', 2 from pipelines where name='RevPipe';
insert into stages (pipeline_id, name, position) select id, 'DA', 1 from pipelines where name='DelPipe';
create temp table rp(k text primary key, id bigint);
create or replace function pg_temp.person(k text, consent text, archived boolean, emails text[], creator int default 1, priv boolean default false, org bigint default null) returns void language plpgsql as $$
declare pid bigint; i int := 0; e text;
begin
  insert into persons (first_name, last_name, owner_id, created_by, consent, archived_at, private, organisation_id)
  values ('Rv', k, creator, creator, consent, case when archived then now() end, priv, org) returning id into pid;
  insert into rp values (k, pid);
  foreach e in array emails loop i := i + 1; insert into person_emails (person_id, email, position) values (pid, e, i); end loop;
end $$;
create or replace function pg_temp.deal(t text, stage text, person text, status text default 'open', archived boolean default false, creator int default 1, priv boolean default false) returns bigint language plpgsql as $$
declare did bigint;
begin
  insert into deals (title, stage_id, person_id, owner_id, created_by, status, closed_at, archived_at, private)
  values (t, (select s.id from stages s join pipelines p on p.id=s.pipeline_id where p.name in ('RevPipe','DelPipe') and s.name=stage),
          (select id from rp where k=person), creator, creator, status, case when status<>'open' then now() end, case when archived then now() end, priv)
  returning id into did; return did;
end $$;
select pg_temp.person('A1','subscribed',false,array['rv.a1@example.test','rv.a1.second@example.test']);
select pg_temp.person('A2','subscribed',false,array['rv.a2@example.test']);
select pg_temp.person('A3','subscribed',false,array['rv.a3@example.test']);
select pg_temp.person('W1','subscribed',false,array['rv.w1@example.test']);
select pg_temp.person('W2','subscribed',false,array['rv.w2@example.test']);
select pg_temp.person('X1','subscribed',false,array['rv.x1@example.test']);
select pg_temp.person('L1','unsubscribed',true,array[]::text[]);
select pg_temp.person('L2','unsubscribed',false,array[]::text[]);
select pg_temp.person('L3','subscribed',false,array[]::text[]);
select pg_temp.person('M1','subscribed',false,array['rv.m1@example.test']);
select pg_temp.person('G1','subscribed',false,array['rv.g1@example.test'],2,true);
select pg_temp.person('V1','subscribed',false,array['rv.v1@example.test']);
select pg_temp.person('O1','subscribed',false,array['rv.o1@example.test'],1,false,(select id from organisations where name='Old Fakeco Archive'));
select pg_temp.person('AL','subscribed',false,array['rv.al@example.test']);
update persons set owner_id=(select id from users where email='alan@barnacle.ai') where last_name='AL' and first_name='Rv';
select pg_temp.person('Z1','subscribed',false,array['rv.z1@example.test']);
select pg_temp.deal('Rv D1','RA','A1');
insert into deal_people (deal_id, person_id) select d.id, (select id from rp where k='A2') from deals d where title='Rv D1';
select pg_temp.deal('Rv D2','RA','A3');
select pg_temp.deal('Rv D3','RA','W1','won');
insert into deal_people (deal_id, person_id) select d.id, (select id from rp where k='W2') from deals d where title='Rv D3';
select pg_temp.deal('Rv D4','RA','X1','open',true);
select pg_temp.deal('Rv D5','RB','A1');
select pg_temp.deal('Rv D6','RB','L1');
select pg_temp.deal('Rv D7','RB','L2');
select pg_temp.deal('Rv D8','RB','L3');
select pg_temp.deal('Rv D9','RB','M1');
select pg_temp.deal('Rv D10','RA','V1','open',false,2,true);
select pg_temp.deal('Rv DZ','DA','Z1');
commit;
-- conditions data
update persons set role='Rv Director', lead_source_id=(select id from lead_sources where name='Inbound') where first_name='Rv' and last_name='A1';
insert into person_labels (person_id, label_id) select p.id, l.id from persons p, labels l where p.first_name='Rv' and p.last_name='A1' and l.name='Hot';
insert into person_labels (person_id, label_id) select p.id, l.id from persons p, labels l where p.first_name='Rv' and p.last_name='A2' and l.name='Partner';
insert into custom_fields (kind, name, type, position, in_list, created_by) values ('person','Rv Opted (fake)','yes_no',90,false,1);
insert into custom_values (field_id, person_id, bool_value) select f.id, p.id, true from custom_fields f, persons p where f.name='Rv Opted (fake)' and p.first_name='Rv' and p.last_name='Z1';
insert into organisations (name, owner_id, created_by) values ('Rv TempOrg', 1, 1);
update persons set organisation_id=(select id from organisations where name='Rv TempOrg') where first_name='Rv' and last_name='Z1';
