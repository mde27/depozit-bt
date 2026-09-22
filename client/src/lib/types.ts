export interface TicketInfo {
  pm_client?: string | null;
  phones?: string | null;
  pickup_address?: string | null;
  delivery_address?: string | null;
  pickup_county?: string | null;
  pickup_locality?: string | null;
  delivery_county?: string | null;
  delivery_locality?: string | null;
  pickup_date?: string | null;
  delivery_date?: string | null;
  time_interval?: string | null;
  return_request?: number | boolean | null;
  return_details?: string | null;
  comments?: string | null;
  recipient?: string | null;
}

export interface TicketItem {
  id: number;
  stock_item_id: number;
  ordered_qty: number;
  sent_qty: number;
  delivered_qty: number;
  return_out_qty: number;
  received_back_qty: number;
  sku: string;
  stock_name: string;
  barcode: string | null;
  stock_qty: number;
  place?: string | null;
}

export interface TicketScan {
  id: number;
  stage: string;
  barcode: string;
  stock_item_id: number | null;
  qty: number;
  created_by: string;
  created_at: string;
  stock_name?: string | null;
  sku?: string | null;
}

export interface TicketHistory {
  id: number;
  at: string;
  username: string;
  action: string;
  details: string | null;
}

export interface Ticket {
  id: number;
  ticket_code: string;
  client_name: string;
  status: string;
  created_by: string;
  fix_comment?: string | null;
  created_at: string;
  updated_at: string;
  info?: TicketInfo | null;
  items?: TicketItem[];
  history?: TicketHistory[];
  scans?: TicketScan[];
}

export interface StockItem {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  company: string | null;
  place: string | null;
  quantity: number;
  comments: string | null;
}

export interface ScanLine {
  barcode: string;
  qty: number;
  name?: string;
  sku?: string;
  /** True when barcode was not found in stock_items */
  unknown?: boolean;
}
