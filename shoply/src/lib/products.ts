export type SizeStock = { size: number; stock: number };

export type Product = {
  id: number;
  name: string;
  price: number;
  description: string;
  sizes: SizeStock[];
};

export const products: Product[] = [
  {
    id: 1,
    name: "클래식 화이트 티셔츠",
    price: 24.0,
    description: "부드러운 코튼 소재의 베이직 화이트 티셔츠입니다. 데일리 코디에 잘 어울립니다.",
    sizes: [
      { size: 240, stock: 5 },
      { size: 250, stock: 3 },
      { size: 260, stock: 0 },
      { size: 270, stock: 8 },
      { size: 280, stock: 2 },
      { size: 290, stock: 0 },
    ],
  },
  {
    id: 2,
    name: "캔버스 토트백",
    price: 18.5,
    description: "튼튼한 캔버스 원단으로 제작된 미니멀 디자인의 토트백.",
    sizes: [
      { size: 240, stock: 0 },
      { size: 250, stock: 4 },
      { size: 260, stock: 6 },
      { size: 270, stock: 1 },
      { size: 280, stock: 0 },
      { size: 290, stock: 3 },
    ],
  },
  {
    id: 3,
    name: "세라믹 커피 머그",
    price: 14.0,
    description: "심플한 디자인의 세라믹 머그컵. 모닝 커피와 함께하세요.",
    sizes: [
      { size: 240, stock: 2 },
      { size: 250, stock: 0 },
      { size: 260, stock: 1 },
      { size: 270, stock: 0 },
      { size: 280, stock: 0 },
      { size: 290, stock: 0 },
    ],
  },
  {
    id: 4,
    name: "가죽 노트북",
    price: 32.0,
    description: "고급 가죽 커버의 노트북. 아이디어를 기록하기에 좋습니다.",
    sizes: [
      { size: 240, stock: 7 },
      { size: 250, stock: 5 },
      { size: 260, stock: 9 },
      { size: 270, stock: 4 },
      { size: 280, stock: 6 },
      { size: 290, stock: 2 },
    ],
  },
  {
    id: 5,
    name: "무선 이어버드",
    price: 89.0,
    description: "선명한 사운드의 무선 이어폰. 충전 케이스 포함.",
    sizes: [
      { size: 240, stock: 0 },
      { size: 250, stock: 0 },
      { size: 260, stock: 0 },
      { size: 270, stock: 0 },
      { size: 280, stock: 0 },
      { size: 290, stock: 0 },
    ],
  },
  {
    id: 6,
    name: "데님 캡",
    price: 22.0,
    description: "어디에나 잘 어울리는 데님 소재 볼캡.",
    sizes: [
      { size: 240, stock: 4 },
      { size: 250, stock: 6 },
      { size: 260, stock: 3 },
      { size: 270, stock: 5 },
      { size: 280, stock: 2 },
      { size: 290, stock: 1 },
    ],
  },
  {
    id: 7,
    name: "울 양말 (3켤레)",
    price: 16.0,
    description: "포근한 울 소재의 양말 3켤레 세트.",
    sizes: [
      { size: 240, stock: 1 },
      { size: 250, stock: 2 },
      { size: 260, stock: 0 },
      { size: 270, stock: 1 },
      { size: 280, stock: 0 },
      { size: 290, stock: 0 },
    ],
  },
  {
    id: 8,
    name: "스테인리스 물병",
    price: 28.0,
    description: "보온·보냉이 뛰어난 스테인리스 텀블러.",
    sizes: [
      { size: 240, stock: 5 },
      { size: 250, stock: 5 },
      { size: 260, stock: 5 },
      { size: 270, stock: 5 },
      { size: 280, stock: 5 },
      { size: 290, stock: 5 },
    ],
  },
];

export function getProduct(id: number): Product | undefined {
  return products.find((p) => p.id === id);
}

export type StockStatus = "재고 있음" | "재고 부족" | "품절";

export function getStockStatus(p: Product): StockStatus {
  const total = p.sizes.reduce((sum, s) => sum + s.stock, 0);
  if (total === 0) return "품절";
  if (total <= 5) return "재고 부족";
  return "재고 있음";
}
