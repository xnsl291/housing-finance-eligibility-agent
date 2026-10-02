# 조건 추출 정확도 — 2026-09-22

`scripts/eval_extraction.py`가 만든 파일임. 손으로 고치지 말 것.

- 모델 `qwen3.5:4b-q4_K_M` (로컬 Ollama, temperature 0)
- 사례 24건 (호출 실패 0건)
- 응답 시간 평균 2.0초 / 최소 0.5초 / 최대 10.0초

## 수치

| 항목 | 값 | 뜻 |
|---|---|---|
| 재현율 | **89.1%** | 문장에 있는 항목 46개 중 41개를 맞게 뽑음 |
| 정밀도 | **71.9%** | 뽑은 값 57개 중 41개가 맞음 |
| 환각률 | **26.3%** | 뽑은 값 중 15개는 문장에 근거가 없음 |
| 문장 단위 완전 일치 | **14/24** | 한 항목도 틀리지 않은 문장 수 |

**환각률이 재현율보다 위험하다.** 놓친 항목은 확인 화면에서 사람이 채우지만,
잘못 채워진 값은 그럴듯해서 그냥 넘어간다.

## 어느 항목이 문제인가

| 항목 | 환각 | 틀림 | 놓침 |
|---|---|---|---|
| `combined_annual_income_krw` | 0 | 0 | 1 |
| `deposit_paid_ratio` | 0 | 0 | 1 |
| `employment_category` | 1 | 0 | 0 |
| `home_ownership_status` | 0 | 0 | 1 |
| `household_head_status` | 1 | 0 | 0 |
| `housing_area_m2` | 1 | 0 | 0 |
| `is_innovation_city_relocated_worker` | 6 | 0 | 0 |
| `is_redevelopment_area_tenant` | 6 | 0 | 0 |
| `marital_status` | 0 | 1 | 0 |
| `minor_children_count` | 0 | 0 | 1 |

## 일관성 (같은 문장 3회)

5/5건이 매번 같은 값을 냈음.

## 사례별

| 사례 | 초 | 맞음 | 틀림 | 놓침 | 환각 |
|---|---|---|---|---|---|
| E-01 | 10.0 | 5 | 0 | 0 | 0 |
| E-02 | 1.4 | 3 | 0 | 0 | 1 |
| E-03 | 4.5 | 3 | 1 | 1 | 2 |
| E-04 | 3.0 | 2 | 0 | 0 | 2 |
| E-05 | 0.9 | 2 | 0 | 0 | 0 |
| E-06 | 1.3 | 2 | 0 | 0 | 0 |
| E-07 | 0.7 | 1 | 0 | 0 | 0 |
| E-08 | 0.8 | 1 | 0 | 0 | 0 |
| E-09 | 0.5 | 0 | 0 | 1 | 0 |
| E-10 | 1.2 | 3 | 0 | 0 | 0 |
| E-11 | 0.7 | 1 | 0 | 0 | 0 |
| E-12 | 0.7 | 1 | 0 | 1 | 1 |
| E-13 | 2.9 | 2 | 0 | 0 | 2 |
| E-14 | 1.0 | 2 | 0 | 0 | 0 |
| E-15 | 1.4 | 3 | 0 | 0 | 0 |
| E-16 | 0.8 | 1 | 0 | 0 | 0 |
| E-17 | 0.7 | 1 | 0 | 0 | 0 |
| E-18 | 2.8 | 0 | 0 | 0 | 3 |
| E-19 | 0.8 | 0 | 0 | 1 | 0 |
| E-20 | 2.0 | 3 | 0 | 0 | 0 |
| E-21 | 2.8 | 1 | 0 | 0 | 0 |
| E-22 | 0.9 | 2 | 0 | 0 | 0 |
| E-23 | 2.6 | 0 | 0 | 0 | 2 |
| E-24 | 3.1 | 2 | 0 | 0 | 2 |

## 무엇을 어떻게 틀렸나

**E-02**
- `employment_category` — 문장에 근거 없는데 `OTHER`을 채움

**E-03**
- `marital_status` 기대 `NEWLYWED` / 받음 `MARRIED`
- `is_innovation_city_relocated_worker` — 문장에 근거 없는데 `False`을 채움
- `is_redevelopment_area_tenant` — 문장에 근거 없는데 `False`을 채움

**E-04**
- `is_innovation_city_relocated_worker` — 문장에 근거 없는데 `False`을 채움
- `is_redevelopment_area_tenant` — 문장에 근거 없는데 `False`을 채움

**E-12**
- `household_head_status` — 문장에 근거 없는데 `HEAD`을 채움

**E-13**
- `is_innovation_city_relocated_worker` — 문장에 근거 없는데 `False`을 채움
- `is_redevelopment_area_tenant` — 문장에 근거 없는데 `False`을 채움

**E-18**
- `housing_area_m2` — 문장에 근거 없는데 `25.0`을 채움
- `is_innovation_city_relocated_worker` — 문장에 근거 없는데 `False`을 채움
- `is_redevelopment_area_tenant` — 문장에 근거 없는데 `False`을 채움

**E-23**
- `is_innovation_city_relocated_worker` — 문장에 근거 없는데 `False`을 채움
- `is_redevelopment_area_tenant` — 문장에 근거 없는데 `False`을 채움

**E-24**
- `is_innovation_city_relocated_worker` — 문장에 근거 없는데 `False`을 채움
- `is_redevelopment_area_tenant` — 문장에 근거 없는데 `False`을 채움
