create table orders (id uuid primary key, status text);
create trigger orders_audit after update on orders for each row execute function audit();
select cron.schedule('expire-orders', '*/5 * * * *', $$ select 1 $$);
create policy "own orders" on orders for select using (true);
