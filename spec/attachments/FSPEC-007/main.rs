use serde::Serialize;
#[derive(Serialize)] struct ServerError { kind: u32, detail: String }
#[derive(Serialize)] struct SessionId { value: String }
#[derive(Serialize)] enum Resp { #[allow(dead_code)] A, B, C, CreateSession(SessionId) }
#[derive(Serialize)] struct Response<T> { request_id: u64, message: Result<T, ServerError> }
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }
fn main() {
    let ok = Response { request_id: 7, message: Ok(Resp::CreateSession(SessionId{ value: "s".into() })) };
    println!("resp_ok_create {}", hex(&bincode::serialize(&ok).unwrap()));
    let err: Response<Resp> = Response { request_id: 7, message: Err(ServerError{ kind: 0, detail: "x".into() }) };
    println!("resp_err {}", hex(&bincode::serialize(&err).unwrap()));
    let r_ok: Result<(), String> = Ok(()); let r_err: Result<(), String> = Err("no".into());
    println!("result_void_ok {}", hex(&bincode::serialize(&r_ok).unwrap()));
    println!("result_void_err {}", hex(&bincode::serialize(&r_err).unwrap()));
    let _ = (Resp::B, Resp::C);
}
