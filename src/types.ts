export type ConnectionStatus = "free" | "requested" | "reserved" | "occupied";
export type ArrivalStatus = "none" | "approaching" | "arrived";
export type DepartureStatus = "none" | "positioned" | "ready" | "departed";
export type LineRequestStatus = "none" | "pending" | "confirmed" | "denied";

export interface Meet {
  id: string;
  name: string;
  slug?: string;
  active_day?: string;
  timezone?: string;
  default_dispatch_mode?: "clearance" | "direct";
  clock_time?: string;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  diagram_order?: number;
  is_autonomous?: boolean;
}

export interface Connection {
  id: string;
  station_a_id: string;
  station_b_id: string;
  track_type: "single" | "double";
  display_side_a?: string;
  display_side_b?: string;
  display_order_a?: number;
  display_order_b?: number;
  tambox_key_a?: string | null;
  tambox_key_b?: string | null;
}

export interface ConnectionState {
  id: string;
  state: ConnectionStatus;
  train_number?: string | null;
  from_station_id?: string | null;
  to_station_id?: string | null;
  request_id?: string | null;
}

export interface TrainRow {
  id: string;
  train_number: string;
  station_id: string;
  station: string;
  track: string;
  days: string;
  arrival_time: string | null;
  departure_time: string | null;
  arrival_from: string | null;
  departure_to: string | null;
  arrival_from_next?: string | null;
  departure_to_next?: string | null;
  sort_time: string;
  train_type: string;
  no_stop: boolean;
  note: string | null;
  manual_sort_order?: number;
  service_id?: string;
}

export interface RouteStop {
  id?: string;
  service_id?: string;
  train_number: string;
  station_id: string;
  station_name?: string;
  stop_order: number;
  arrival_time: string | null;
  departure_time: string | null;
}

export interface ClockState {
  configured?: boolean;
  time: string;
  speed?: number;
  running?: boolean;
  stopped_reason?: string | null;
  show_seconds?: boolean;
  available_styles?: string[];
}

export interface TrainPosition {
  train_number: string;
  status: "station" | "connection";
  station_id?: string | null;
  connection_id?: string | null;
  from_station_id?: string | null;
  to_station_id?: string | null;
}

export interface RuntimeSnapshot {
  protocol_version?: number;
  revision?: number;
  publication_id: string;
  meet: Meet;
  active_day: string;
  stations: Station[];
  connections: Connection[];
  connection_states: ConnectionState[];
  trains: TrainRow[];
  routes: RouteStop[];
  services?: unknown[];
  autonomous_links?: unknown[];
  display?: {
    graph_station_order?: string[];
    topology_branch_station_ids?: string[];
    default_theme?: string;
  };
  clock: ClockState;
  train_positions: TrainPosition[];
  server_time?: string;
}

export interface LocalMovementState {
  arrival: ArrivalStatus;
  departure: DepartureStatus;
  actualTrack?: string;
  lineRequest: LineRequestStatus;
}

