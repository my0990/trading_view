'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import IndexChartCard from './IndexChartCard';

const STORAGE_KEY = 'dashboard:order';

// 저장된 순서를 현재 카드 목록에 맞춥니다. 없어진 카드는 빼고, 새 카드는 맨 뒤에 붙입니다.
function applyOrder(items, savedIds) {
  const byId = new Map(items.map((it) => [it.symbol, it]));
  const ordered = savedIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const rest = items.filter((it) => !savedIds.includes(it.symbol));
  return [...ordered, ...rest];
}

function SortableCard({ item }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.symbol });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="drag-handle"
      aria-label={`${item.label} 순서 옮기기`}
      title="끌어서 순서 바꾸기"
      {...attributes}
      {...listeners}
    >
      ⋮⋮
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'is-dragging' : undefined}>
      <IndexChartCard
        symbol={item.symbol}
        label={item.label}
        endpoint={item.endpoint}
        rangeLabel={item.rangeLabel}
        handle={handle}
      />
    </div>
  );
}

export default function Dashboard({ items }) {
  const [list, setList] = useState(items);
  const [customized, setCustomized] = useState(false);

  // 이 브라우저에 저장된 순서 불러오기
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved)) {
        setList(applyOrder(items, saved));
        setCustomized(true);
      }
    } catch {}
  }, [items]);

  const save = (next) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map((it) => it.symbol)));
    } catch {}
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setList((prev) => {
      const from = prev.findIndex((it) => it.symbol === active.id);
      const to = prev.findIndex((it) => it.symbol === over.id);
      const next = arrayMove(prev, from, to);
      save(next);
      return next;
    });
    setCustomized(true);
  };

  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setList(items);
    setCustomized(false);
  };

  return (
    <>
      <div className="dashboard__toolbar">
        <span>카드 제목 옆 ⋮⋮ 를 끌어서 순서를 바꿀 수 있어요</span>
        {customized && (
          <button type="button" className="dashboard__reset" onClick={reset}>
            기본 순서로
          </button>
        )}
      </div>
      <DndContext id="dashboard-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((it) => it.symbol)} strategy={rectSortingStrategy}>
          <div className="dashboard__grid">
            {list.map((item) => (
              <SortableCard key={item.symbol} item={item} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  );
}
